import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
} from '@diabetes/types';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  primary_role: 'patient' | 'clinician' | 'admin';
  created_at: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existing = await this.db.queryOne<{ id: string }>(
      'select id from identity.users where lower(email) = lower($1)',
      [input.email],
    );
    if (existing) {
      throw new ConflictException('An account with that email already exists');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const user = await this.db.transaction(async (client) => {
      const { rows } = await client.query<UserRow>(
        `insert into identity.users (email, display_name, primary_role)
         values ($1, $2, 'patient')
         returning id, email, display_name, primary_role, created_at`,
        [input.email, input.displayName ?? null],
      );
      const created = rows[0];

      await client.query(
        'insert into identity.credentials (user_id, password_hash) values ($1, $2)',
        [created.id, passwordHash],
      );

      await this.audit.record(
        {
          actorUserId: created.id,
          subjectUserId: created.id,
          action: 'auth.register',
          resourceType: 'user',
          resourceId: created.id,
        },
        client,
      );

      return created;
    });

    return { user: toUser(user), tokens: await this.issueTokens(user) };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const row = await this.db.queryOne<UserRow & { password_hash: string | null }>(
      `select u.id, u.email, u.display_name, u.primary_role, u.created_at,
              c.password_hash
         from identity.users u
         left join identity.credentials c on c.user_id = u.id
        where lower(u.email) = lower($1) and u.status = 'active'`,
      [input.email],
    );

    // Always run a verification so a missing account and a wrong password take
    // comparable time and cannot be told apart by timing.
    const hash = row?.password_hash ?? DUMMY_ARGON2_HASH;
    const passwordOk = await argon2.verify(hash, input.password).catch(() => false);

    if (!row || !row.password_hash || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // The audit entry and the session it describes commit together: a
    // recorded login with no session, or a session with no record of the
    // login, would both misrepresent what happened.
    const tokens = await this.db.transaction(async (client) => {
      await this.audit.record(
        {
          actorUserId: row.id,
          subjectUserId: row.id,
          action: 'auth.login',
          resourceType: 'user',
          resourceId: row.id,
        },
        client,
      );
      return this.issueTokens(row, client);
    });

    return { user: toUser(row), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashToken(refreshToken);
    const row = await this.db.queryOne<UserRow & { token_id: string }>(
      `select u.id, u.email, u.display_name, u.primary_role, u.created_at,
              r.id as token_id
         from identity.refresh_tokens r
         join identity.users u on u.id = r.user_id
        where r.token_hash = $1
          and r.revoked_at is null
          and r.expires_at > now()
          and u.status = 'active'`,
      [tokenHash],
    );

    if (!row) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: a refresh token is single-use, so a stolen one is useful at most
    // once. Revoking the old token and issuing the new one is atomic, or a
    // failure between them would strand the session with no valid token.
    const tokens = await this.db.transaction(async (client) => {
      await client.query(
        'update identity.refresh_tokens set revoked_at = now() where id = $1',
        [row.token_id],
      );
      return this.issueTokens(row, client);
    });

    return { user: toUser(row), tokens };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    await this.db.transaction(async (client) => {
      if (refreshToken) {
        await client.query(
          `update identity.refresh_tokens set revoked_at = now()
            where user_id = $1 and token_hash = $2 and revoked_at is null`,
          [userId, hashToken(refreshToken)],
        );
      } else {
        await client.query(
          `update identity.refresh_tokens set revoked_at = now()
            where user_id = $1 and revoked_at is null`,
          [userId],
        );
      }

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'auth.logout',
          resourceType: 'user',
          resourceId: userId,
        },
        client,
      );
    });
  }

  private async issueTokens(user: UserRow, client?: PoolClient) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.primary_role },
      { expiresIn: this.env.JWT_ACCESS_TTL as `${number}m` },
    );

    // The refresh token is random, not a JWT: only its hash is stored, so a
    // database leak does not hand an attacker usable sessions.
    const refreshToken = randomBytes(48).toString('base64url');
    const insert = `insert into identity.refresh_tokens (user_id, token_hash, expires_at)
                    values ($1, $2, now() + $3::interval)`;
    const params = [
      user.id,
      hashToken(refreshToken),
      toPostgresInterval(this.env.JWT_REFRESH_TTL),
    ];
    if (client) {
      await client.query(insert, params);
    } else {
      await this.db.query(insert, params);
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: ttlToSeconds(this.env.JWT_ACCESS_TTL),
    };
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    primaryRole: row.primary_role,
    createdAt: row.created_at,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Converts `15m` / `30d` style TTLs into a Postgres interval literal. */
function toPostgresInterval(ttl: string): string {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);
  const units = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' } as const;
  return `${match[1]} ${units[match[2] as keyof typeof units]}`;
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[
    match[2] as 's' | 'm' | 'h' | 'd'
  ];
  return Number(match[1]) * multiplier;
}

/**
 * A real argon2id hash of a value nobody knows, used only to keep the login
 * path constant-time when the account does not exist.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$J8xkOaFVEUMFDPz1xnZL/CZ2A6a0GHIMLxKMPYTPfvA';
