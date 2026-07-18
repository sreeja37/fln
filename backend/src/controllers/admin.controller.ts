import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { AdminService } from '../services/admin.service';

/**
 * Controller for the Admin module.
 *
 * Surface area (Phase 1):
 *   - GET /api/admin/coordinators  -> getCoordinators
 *
 * Response shape:
 *   Returns a raw JSON array (no `success` / `data` envelope) so the
 *   frontend's `Array.isArray(data)` checks at RoleDashboards.tsx line 581
 *   and PanelViews.tsx line 274 keep working unchanged. Same convention
 *   as `class.controller` and `student.controller` — and as the legacy
 *   `index.ts` GET /api/admin/coordinators handler, which is the wire
 *   contract this slice replaces.
 *
 * Auth:
 *   `router.use(authenticate)` upstream guarantees `req.user` is populated
 *   before this handler runs (or a 401 has already been sent). The legacy
 *   handler only checks authentication, not role, so the migrated slice
 *   intentionally does the same. A `requireRole('superadmin' | 'admin' |
 *   'district_admin' | 'block_admin')` middleware can be inserted in the
 *   route file later without changing the controller.
 */
const adminService = new AdminService();

export class AdminController {
  /**
   * GET /api/admin/coordinators
   *
   * Returns the full user roster from the `users` collection. The
   * frontend renders this into the "Registered Coordinators Index"
   * table and uses the geographic fields (`stateCode`, `districtCode`,
   * `schoolId`) for client-side filtering.
   *
   * No request body or query params are read; the route handler is a
   * pure passthrough to the service layer.
   */
  async getCoordinators(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await adminService.listCoordinators();
      res.status(httpStatus.OK).json(users);
    } catch (error) {
      next(error);
    }
  }
}
