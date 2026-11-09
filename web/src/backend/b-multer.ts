// Browser replacement for multer: the worker already decoded the upload into req.files.
import type { Request, Response, NextFunction } from "./b-express.ts";
export default function multer(_opts?: unknown) {
  return {
    single: (field: string) => (req: Request, _res: Response, next: NextFunction) => {
      req.file = (req.files || []).find((f) => f.fieldname === field);
      next();
    },
  };
}
multer.memoryStorage = () => ({});
