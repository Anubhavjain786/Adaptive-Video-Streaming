import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow frontend dev server to call the API
  app.enableCors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  });

  await app.listen(3000);
  console.log("Backend running on http://localhost:3000");
}

bootstrap();
