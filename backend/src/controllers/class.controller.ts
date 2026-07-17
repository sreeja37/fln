import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { ClassService } from '../services/class.service';

const classService = new ClassService();

export class ClassController {
  // Reads teacherId from the verified JWT (req.user.teacherId), delegates to the
  // service, and returns a raw JSON array so the frontend's Array.isArray() check
  // in fetchTeacherData works without an envelope.
  async getClassesForCurrentTeacher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teacherId = req.user?.teacherId;

      if (!teacherId) {
        res.status(httpStatus.UNAUTHORIZED).json({
          error: 'teacherId claim missing from JWT',
        });
        return;
      }

      const classes = await classService.getClassesByTeacher(teacherId);

      res.status(httpStatus.OK).json(classes);
    } catch (error) {
      next(error);
    }
  }
}