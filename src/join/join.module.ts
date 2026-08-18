import { Module } from '@nestjs/common';
import { JoinController } from './join.controller';

@Module({
  controllers: [JoinController],
})
export class JoinModule {}
