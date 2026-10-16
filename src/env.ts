import * as dotenv from 'dotenv';
import { readEnvironmentValue } from './utils.js';

if (readEnvironmentValue(process.env, 'NODE_ENV') !== 'production') {
  dotenv.config();
}
