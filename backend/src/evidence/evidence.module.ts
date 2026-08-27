import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  imports: [DiabetesProfileModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
