import mongoose from "mongoose";
import { config } from "../config/appConfig.js";

const MONGO_URL = config.db.mongoUrl;

export async function connectDB(): Promise<void> {
  const maxRetries = 12;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await mongoose.connect(MONGO_URL);
      console.log("[db] Connected to MongoDB:", MONGO_URL);
      return;
    } catch {
      attempt++;
      console.warn(`[db] Attempt ${attempt}/${maxRetries} failed — retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("[db] Could not connect to MongoDB after max retries");
}

mongoose.connection.on("error", (err) => console.error("[db] Error:", err));
mongoose.connection.on("disconnected", () => console.warn("[db] Disconnected"));
