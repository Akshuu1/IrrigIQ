import mongoose from 'mongoose';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

let isConnected = false;

export async function connectDb(): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const env = getEnv();
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    logger.info('Connected to MongoDB');
    return conn;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB');
    throw error;
  }
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB');
  }
}

export async function checkMongoHealth(): Promise<boolean> {
  try {
    // 1 = connected, 2 = connecting
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
