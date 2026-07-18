import mongoose from 'mongoose';
import { User } from '../db';

/**
 * Repository for the Admin module.
 *
 * Data source:
 *   - The `users` collection in MongoDB, accessed through the active
 *     Mongoose connection that `config/database.ts connectDatabase()`
 *     establishes at server startup. There is no Mongoose `User` model
 *     in the new architecture yet (only `Teacher` has been migrated), so
 *     we deliberately query the collection directly via
 *     `mongoose.connection.db.collection('users')` rather than
 *     introducing a parallel Mongoose schema. This keeps the migration
 *     additive: a future ticket can introduce `models/user.model.ts` +
 *     a Mongoose repository without changing the controller or service
 *     surface.
 *
 * Surface area (Phase 1):
 *   - findAllUsers()  — returns every user document verbatim, matching the
 *                       legacy `index.ts` GET /api/admin/coordinators
 *                       wire-format (raw array, no projection, no mask).
 *
 * Why we don't call `dbStore.getUsers()`:
 *   The shared `dbStore` in `db.ts` reads from a private raw
 *   `MongoClient` (`mongoClient`) that the **legacy** `src/index.ts`
 *   entry populates by calling `connectDB()` at startup. The new
 *   `src/server.ts` entry uses `config/database.ts connectDatabase()`
 *   which goes through **Mongoose** instead, so `dbStore.mongoDb` stays
 *   null and `dbStore.getUsers()` throws a TypeError. Per the migration
 *   rules we cannot modify `server.ts` to call `connectDB()` as well, so
 *   we route around `dbStore` and read from the Mongoose-managed
 *   connection that is actually live.
 */
export class AdminRepository {
  /**
   * Return all user documents from the `users` collection. The shape on
   * the wire is the raw Mongo document array — same as the legacy
   * endpoint — because the frontend (RoleDashboards.tsx line 581,
   * PanelViews.tsx line 274) does `Array.isArray(d)` and reads fields
   * like `name`, `stateCode`, `districtCode` directly. Removing `_id`
   * or masking fields would break those callers.
   *
   * Throws `AppError(503)`-style errors via the global errorHandler
   * when the Mongoose connection is not yet ready.
   */
  async findAllUsers(): Promise<User[]> {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('MongoDB connection is not ready');
    }
    return db.collection<User>('users').find({}).toArray();
  }
}