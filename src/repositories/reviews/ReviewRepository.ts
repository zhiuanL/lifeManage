import type { Review } from "../../domain/reviews/Review";

export interface ReviewRepository {
  list(): Promise<readonly Review[]>;
  findById(id: string): Promise<Review | null>;
  create(review: Review): Promise<void>;
  update(review: Review): Promise<void>;
}
