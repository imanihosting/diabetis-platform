import { Module } from '@nestjs/common';
import { DiabetesProfileController } from './diabetes-profile.controller';
import { DiabetesProfileService } from './diabetes-profile.service';

@Module({
  controllers: [DiabetesProfileController],
  providers: [DiabetesProfileService],
  exports: [DiabetesProfileService],
})
export class DiabetesProfileModule {}
