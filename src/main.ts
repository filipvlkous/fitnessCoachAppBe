import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config as dotEnvConfig } from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import compression from 'compression';

dotEnvConfig();

async function bootstrap() {
  // Disable the default parsers so the limit below is the only one applied.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Registered before anything else so every response passes through it. The
  // app's payloads are JSON (program weeks, monthly summaries, the product
  // feed) and compress by roughly 70-85%, which is what mobile clients on a
  // cellular connection actually wait on. Defaults are left alone: the 1kb
  // threshold skips responses too small to be worth a gzip pass, and the
  // default filter already declines content types that are compressed
  // already (images, video).
  app.use(compression());

  // Sized for the one endpoint that posts anything large: a base64 photo to
  // `image-analysis/food/analyze`, capped at MAX_IMAGE_BASE64_CHARS (10 MB) by
  // the DTO. The limit sits just above that so an oversized body is rejected
  // by the parser rather than buffered into memory first — at the previous
  // 50mb a handful of concurrent uploads could exhaust the container. File
  // uploads are multipart and go through multer's own limits, untouched here.
  app.useBodyParser('json', { limit: '12mb' });
  app.useBodyParser('urlencoded', { limit: '12mb', extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Set CORS_ORIGINS=https://app.example.com,https://admin.example.com in production.
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : '*',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fitness App API')
    .setDescription('Backend API for the fitness coaching app')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = 8080;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
