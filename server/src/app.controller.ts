import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { MonitorService, countryName } from './monitor.service';
import { ServerInfoService } from './server-info.service';
import { config } from './config';

function checkAuth(token: string | undefined) {
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(config.token);
  if (a.length !== b.length || !a.equals(b)) {
    throw new UnauthorizedException('invalid token');
  }
}

function hoursOf(raw: string | undefined): number {
  const h = Number(raw) || config.rangeHours;
  return Math.min(168, Math.max(1, h));
}

@Controller('api')
export class AppController {
  constructor(
    private readonly monitor: MonitorService,
    private readonly serverInfo: ServerInfoService,
  ) {}

  @Get('meta')
  meta() {
    return { siteName: config.siteName, version: '2.0.0', serverTime: Date.now() };
  }

  @Post('auth/login')
  login(@Body() body: { password?: string }) {
    if (!body || body.password !== config.adminPassword) {
      throw new UnauthorizedException('密码错误');
    }
    return { token: config.token };
  }

  @Get('overview')
  overview(
    @Headers('x-monitor-token') token: string,
    @Query('hours') hours: string,
  ) {
    checkAuth(token);
    return this.monitor.overview(hoursOf(hours));
  }

  @Get('timeseries')
  timeseries(
    @Headers('x-monitor-token') token: string,
    @Query('hours') hours: string,
    @Query('bucketMin') bucketMin: string,
  ) {
    checkAuth(token);
    const bm = Math.max(1, Number(bucketMin) || 30);
    return { buckets: this.monitor.timeseries(hoursOf(hours), bm) };
  }

  @Get('top')
  top(
    @Headers('x-monitor-token') token: string,
    @Query('dim') dim: string,
    @Query('hours') hours: string,
    @Query('limit') limit: string,
  ) {
    checkAuth(token);
    const allowed = ['domain', 'ip', 'country', 'user', 'port', 'transport'];
    if (!allowed.includes(dim)) throw new BadRequestException('invalid dim');
    const lm = Math.min(50, Number(limit) || 10);
    return { items: this.monitor.top(dim, hoursOf(hours), lm) };
  }

  @Get('countries')
  countries(
    @Headers('x-monitor-token') token: string,
    @Query('hours') hours: string,
    @Query('limit') limit: string,
  ) {
    checkAuth(token);
    return {
      items: this.monitor.topCountriesWithCode(hoursOf(hours), Math.min(50, Number(limit) || 20)),
    };
  }

  @Get('events')
  events(
    @Headers('x-monitor-token') token: string,
    @Query('hours') hours: string,
    @Query('limit') limit: string,
    @Query('action') action: string,
  ) {
    checkAuth(token);
    const lm = Math.min(500, Number(limit) || 50);
    const act = action === 'accepted' || action === 'rejected' ? action : undefined;
    return { items: this.monitor.eventsRecent(hoursOf(hours), lm, act) };
  }

  @Get('security')
  security(@Headers('x-monitor-token') token: string, @Query('hours') hours: string) {
    checkAuth(token);
    return this.monitor.security(hoursOf(hours));
  }

  @Get('usershare')
  userShare(@Headers('x-monitor-token') token: string, @Query('hours') hours: string) {
    checkAuth(token);
    return { items: this.monitor.userShare(hoursOf(hours)) };
  }

  @Get('userprofile')
  userProfile(
    @Headers('x-monitor-token') token: string,
    @Query('hours') hours: string,
    @Query('users') users: string,
    @Query('limit') limit: string,
  ) {
    checkAuth(token);
    const ul = Math.min(50, Number(users) || 10);
    const lm = Math.min(50, Number(limit) || 10);
    return { items: this.monitor.userProfile(hoursOf(hours), ul, lm) };
  }

  @Get('server')
  server(@Headers('x-monitor-token') token: string) {
    checkAuth(token);
    return this.serverInfo.info();
  }

  @Post('logs/clear')
  clearLogs(
    @Headers('x-monitor-token') token: string,
    @Body() body: { truncateSource?: boolean },
  ) {
    checkAuth(token);
    return this.monitor.clearLogs(body?.truncateSource !== false);
  }
}

export { countryName };
