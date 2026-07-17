import { IClass, IClassDocument } from '../interfaces/class.interface';
import { Class } from '../models/class.model';

export class ClassRepository {
  async findByTeacherId(teacherId: string): Promise<IClassDocument[]> {
    return Class.find({ teacherId }).sort({ className: 1, section: 1 }).exec();
  }
}