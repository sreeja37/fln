import { AdminRepository } from '../repositories/admin.repository';
import { User } from '../db';

/**
 * Service for the Admin module.
 *
 * Mirrors the lightweight ClassService / StudentService pattern: a
 * constructor-injected repository and thin pass-through methods. No
 * business logic lives here in Phase 1 — the legacy `index.ts`
 * GET /api/admin/coordinators handler is a straight read, and the goal
 * of this migration is to preserve that wire contract, not redesign it.
 *
 * Future admin endpoints (revive-teacher, restore-school, etc. — all
 * currently still in `index.ts`) can extend this service without
 * reshaping the controller.
 */
export class AdminService {
  private repository: AdminRepository;

  constructor() {
    this.repository = new AdminRepository();
  }

  /**
   * List all user accounts. The frontend (RoleDashboards.tsx line 581,
   * PanelViews.tsx line 274) consumes this as a raw array and filters
   * client-side for the Coordinators Index table, so we preserve the
   * exact shape returned by `dbStore.getUsers()` — including `_id`,
   * `email`, `name`, `role`, and the optional geographic fields.
   *
   * No role gating is applied here. The legacy handler only required
   * authentication (`if (!user) return 401`), so we mirror that
   * semantics. Role-based restriction can be added later via a
   * `requireRole(...)` middleware without changing this method.
   */
  async listCoordinators(): Promise<User[]> {
    return this.repository.findAllUsers();
  }
}
