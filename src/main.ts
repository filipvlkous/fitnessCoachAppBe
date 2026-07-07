import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config as dotEnvConfig } from 'dotenv';
import { ValidationPipe } from '@nestjs/common';

dotEnvConfig();

async function bootstrap() {
  // Disable the default parsers so the 50mb limit below is the only one applied.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

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
