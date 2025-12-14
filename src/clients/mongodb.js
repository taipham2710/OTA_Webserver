import { MongoClient } from 'mongodb';
import { config } from '../config/index.js';

let mongoClient = null;
let db = null;

export const getMongoClient = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongo.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongo.db);
  }
  return { client: mongoClient, db };
};

export const getDb = async () => {
  if (!db) {
    await getMongoClient();
  }
  return db;
};

export const closeMongoConnection = async () => {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
  }
};

