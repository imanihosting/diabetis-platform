import { Module } from '@nestjs/common';
import { ExperimentsController } from './experiments.controller';
import { ExperimentsService } from './experiments.service';
import { DiabetesProfileModule } from '../diabetes-profile/diabetes-profile.module';

@Module({
  // The safety decision needs the care mode and the flags in force, and both
  // come from the profile rather than from the request.
  imports: [DiabetesProfileModule],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
