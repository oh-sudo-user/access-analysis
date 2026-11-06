import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MonitorService } from './monitor.service';

@Module({
  controllers: [AppController],
  providers: [MonitorService],
})
export class AppModule {}
