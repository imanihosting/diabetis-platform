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
} from '@wellovue/types';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { toPostgresInterval, ttlToSeconds } from '../common/ttl';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';
import { VerificationService } from './verification.service';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  primary_role: 'patient' | 'clinician' | 'admin';
  created_at: Date;
  email_verified_at: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly profiles: DiabetesProfileService,
    private readonly verification: VerificationService,
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
      // Created unverified. `email_verified_at` is left null rather than set,
      // which is what the guard on the product routes reads: a new account can
      // sign in and see its own status, and nothing else, until the address
      // has been proven.
      const { rows } = await client.query<UserRow>(
        `insert into identity.users (email, display_name, primary_role)
         values ($1, $2, 'patient')
         returning id, email, display_name, primary_role, created_at, email_verified_at`,
        [input.email, input.displayName ?? null],
      );
      const created = rows[0];

      await client.query(
        'insert into identity.credentials (user_id, password_hash) values ($1, $2)',
        [created.id, passwordHash],
      );

      // In the same transaction as the account. A user without a profile reads
      // as care mode `unknown`, which switches the evidence screen off, and
      // arriving in that state through a half-completed registration is not a
      // safety decision anybody made.
      await this.profiles.createForNewUser(created.id, client);

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

      // Queued, not sent. The outbox row commits with the account, so a
      // rolled-back registration has emailed nobody, and Microsoft Graph being
      // slow or throttled never decides whether somebody gets an account.
      await this.verification.sendVerification(created, client);

      return created;
    });

    return { user: toUser(user), tokens: await this.issueTokens(user) };
  }

  async login(input: LoginInput, userAgent?: string): Promise<AuthResponse> {
    const row = await this.db.queryOne<UserRow & { password_hash: string | null }>(
      `select u.id, u.email, u.display_name, u.primary_role, u.created_at,
              u.email_verified_at, c.password_hash
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

    // After the session exists, and deliberately outside its transaction. This
    // is a courtesy notification: it must not be able to fail a sign-in, and a
    // mail provider having a bad afternoon must not roll back somebody's
    // session. `noteSignInDevice` swallows and logs its own failures for the
    // same reason.
    await this.verification.noteSignInDevice(row, userAgent);

    return { user: toUser(row), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashToken(refreshToken);
    const row = await this.db.queryOne<UserRow & { token_id: string }>(
      `select u.id, u.email, u.display_name, u.primary_role, u.created_at,
              u.email_verified_at, r.id as token_id
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
    // `verified` rides along so the guard on the product routes can answer
    // from the token for the common case. It is a claim about a moment 15
    // minutes ago at worst, which is why the guard treats `false` as "ask the
    // database" rather than as a refusal — see EmailVerifiedGuard. A verified
    // user therefore pays nothing, and an unverified one pays a lookup until
    // their next token.
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.primary_role,
        verified: user.email_verified_at !== null,
      },
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
    emailVerifiedAt: row.email_verified_at,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A real argon2id hash of a value nobody knows, used only to keep the login
 * path constant-time when the account does not exist.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$J8xkOaFVEUMFDPz1xnZL/CZ2A6a0GHIMLxKMPYTPfvA';
