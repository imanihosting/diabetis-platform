import { Module } from '@nestjs/common';
import { GlucoseController } from './glucose.controller';
import { GlucoseService } from './glucose.service';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  // The CSV import reads the account's timezone: an offset-less device
  // timestamp is the person's wall clock, not the server's.
  imports: [DiabetesProfileModule],
  controllers: [GlucoseController],
  providers: [GlucoseService],
  exports: [GlucoseService],
})
export class GlucoseModule {}
