import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config as dotEnvConfig } from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

dotEnvConfig();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  app.use(bodyParser.json({ limit: '50mb' })); // for JSON bodies
  app.enableCors({
    origin: '*', // or better, your specific front‐end origin
  });
  app.use(
    bodyParser.urlencoded({
      // if you ever need URL-encoded bodies
      limit: '50mb',
      extended: true,
    }),
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
