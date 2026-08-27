import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ENV, type Env } from '../config/env';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  imports: [
    // Registration creates the account and its diabetes profile in one
    // transaction, so AuthService needs the profile service.
    DiabetesProfileModule,
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        // Env validation guarantees the `<number><unit>` shape that `ms`
        // requires; its type is narrower than the schema can express.
        signOptions: { expiresIn: env.JWT_ACCESS_TTL as `${number}m` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
