import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableCors();

  // serve static frontend with SPA fallback
  if (fs.existsSync(config.publicDir)) {
    app.use(express.static(config.publicDir));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      const indexFile = path.join(config.publicDir, 'index.html');
      if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
      next();
    });
  }

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`access-monitor listening on :${config.port}`);
}

bootstrap();
