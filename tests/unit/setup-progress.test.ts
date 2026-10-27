import { expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { validateSetupProgress } from "../../src/domain/system/SetupProgress";

it("preserves initialization progress across repeated bootstrap", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  expect(await app.setupProgressService.get()).toEqual({ step: 0, completed: false });
  await app.setupProgressService.save({ step: 4, completed: false });
  await app.bootstrapApplicationService.bootstrap();
  expect(await app.setupProgressService.get()).toEqual({ step: 4, completed: false });
  await app.setupProgressService.save({ step: 5, completed: true });
  expect(await app.setupProgressService.get()).toEqual({ step: 5, completed: true });
});

it("rejects invalid steps without changing saved progress", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const before = await app.setupProgressService.get();
  expect(() => validateSetupProgress({ step: 6, completed: false })).toThrow();
  await expect(app.setupProgressService.save({ step: -1, completed: false })).rejects.toThrow();
  expect(await app.setupProgressService.get()).toEqual(before);
});
