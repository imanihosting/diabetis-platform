import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule re-exports JwtModule, used to recognise a signed-in sender.
  imports: [AuthModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
