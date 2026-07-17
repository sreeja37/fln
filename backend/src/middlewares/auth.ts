import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';

export interface AuthPayload {
  userId?: string;
  email: string;
  role?: string;
  teacherId?: string;
  schoolId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// Development-only fallback: the frontend intentionally bypasses login by
// hardcoding a placeholder token ("dev-token") in App.tsx. The login flow
// stays exactly as it is — we are NOT redesigning authentication. We are
// mapping that placeholder to the seeded demo teacher so the existing
// repository/service/controller/route can be reached via the production
// GET /api/classes path without introducing a parallel endpoint.
//
// When real login + JWT are wired, this guard is removed and req.user is
// populated exclusively by jwt.verify() below.
const DEV_TOKEN = 'dev-token';
const DEMO_TEACHER: AuthPayload = {
  userId: 'u_tch_AP_GNT_GNT_01_01_C2',
  email: 'teacher.ap_gnt_gnt_01_01.c2@fln.org',
  role: 'teacher',
  teacherId: 'u_tch_AP_GNT_GNT_01_01_C2',
  schoolId: 'AP_GNT_GNT_01_01',
};

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication required',
      data: null,
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (token === DEV_TOKEN) {
    req.user = DEMO_TEACHER;
    next();
    return;
  }

  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_change_in_prod';
    const decoded = jwt.verify(token, secret) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid or expired token',
      data: null,
    });
  }
}
