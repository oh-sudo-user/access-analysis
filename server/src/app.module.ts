import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MonitorService } from './monitor.service';
import { ServerInfoService } from './server-info.service';

@Module({
  controllers: [AppController],
  providers: [MonitorService, ServerInfoService],
})
export class AppModule {}
