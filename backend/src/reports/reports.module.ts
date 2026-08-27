import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EvidenceModule } from '../evidence/evidence.module';
import { GlucoseModule } from '../glucose/glucose.module';
import { LabsModule } from '../labs/labs.module';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  // Everything a packet says is already said somewhere else in the product.
  // Reading it through the same services is what keeps the page a clinician
  // sees and the page a patient sees from disagreeing — and reaching the
  // engine through EvidenceModule keeps the care-mode gate in the path.
  imports: [EvidenceModule, GlucoseModule, LabsModule, DiabetesProfileModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
