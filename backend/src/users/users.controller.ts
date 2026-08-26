import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@diabetes/types';
import { DatabaseService } from '../database/database.service';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    const row = await this.db.queryOne<{
      id: string;
      email: string;
      display_name: string | null;
      primary_role: User['primaryRole'];
      created_at: Date;
    }>(
      `select id, email, display_name, primary_role, created_at
         from identity.users where id = $1`,
      [user.id],
    );

    if (!row) throw new Error('Authenticated user no longer exists');

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      primaryRole: row.primary_role,
      createdAt: row.created_at,
    };
  }

  @Get('me/audit')
  @ApiOperation({ summary: 'Access trail for the current user’s own records' })
  async myAudit(@CurrentUser() user: AuthenticatedUser) {
    return this.audit.listForSubject(user.id);
  }
}
