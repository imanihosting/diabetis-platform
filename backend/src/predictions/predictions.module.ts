import { Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { EvidenceModule } from '../evidence/evidence.module';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  // A prediction is made from the evidence as it stands, read through the same
  // service the Evidence screen uses, so the number written down is the number
  // the person was looking at.
  imports: [EvidenceModule, DiabetesProfileModule],
  controllers: [PredictionsController],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
