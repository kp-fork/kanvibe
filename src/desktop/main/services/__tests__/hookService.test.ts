import { beforeEach, describe, expect, it, vi } from "vitest";

const entityMocks = vi.hoisted(() => ({
  TaskStatus: {
    TODO: "todo",
    PROGRESS: "progress",
    PENDING: "pending",
    REVIEW: "review",
    DONE: "done",
  },
  SessionType: {
    TMUX: "tmux",
    ZELLIJ: "zellij",
  },
}));

const mocks = vi.hoisted(() => ({
  projectRepo: {
    findOneBy: vi.fn(),
  },
  taskRepo: {
    findOne: vi.fn(),
    findOneBy: vi.fn(),
    save: vi.fn(),
    create: vi.fn(),
  },
  createWorktreeWithSession: vi.fn(),
  broadcastBoardUpdate: vi.fn(),
  broadcastHookStatusTargetMissing: vi.fn(),
  broadcastTaskStatusChanged: vi.fn(),
  installTaskHooksImmediately: vi.fn(),
  prepareOptimisticDoneTransition: vi.fn(),
  scheduleDoneCleanupWithRollback: vi.fn(),
}));

vi.mock("@/entities/KanbanTask", () => entityMocks);

const { TaskStatus } = entityMocks;

vi.mock("@/lib/database", () => ({
  getProjectRepository: vi.fn(async () => mocks.projectRepo),
  getTaskRepository: vi.fn(async () => mocks.taskRepo),
}));

vi.mock("@/lib/worktree", () => ({
  createWorktreeWithSession: mocks.createWorktreeWithSession,
}));

vi.mock("@/lib/boardNotifier", () => ({
  broadcastBoardUpdate: mocks.broadcastBoardUpdate,
  broadcastHookStatusTargetMissing: mocks.broadcastHookStatusTargetMissing,
  broadcastTaskStatusChanged: mocks.broadcastTaskStatusChanged,
}));

vi.mock("@/desktop/main/services/kanbanService", () => ({
  installTaskHooksImmediately: mocks.installTaskHooksImmediately,
  prepareOptimisticDoneTransition: mocks.prepareOptimisticDoneTransition,
  scheduleDoneCleanupWithRollback: mocks.scheduleDoneCleanupWithRollback,
}));

async function flushMicrotasks(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("hookService.updateHookTaskStatus", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.prepareOptimisticDoneTransition.mockImplementation((task, options = {}) => {
      const cleanupTask = { ...task };
      const rollbackSnapshot = {
        id: task.id,
        status: task.status,
        sessionType: task.sessionType,
        sessionName: task.sessionName,
        worktreePath: task.worktreePath,
        sshHost: task.sshHost,
      };

      task.status = TaskStatus.DONE;
      task.sessionType = null;
      task.sessionName = null;
      task.worktreePath = null;

      if ((options as { clearSshHost?: boolean }).clearSshHost) {
        task.sshHost = null;
      }

      return { cleanupTask, rollbackSnapshot };
    });
  });

  it("taskId로 작업 상태를 변경한다", async () => {
    const { updateHookTaskStatus } = await import("@/desktop/main/services/hookService");
    const project = { id: "project-1", name: "kanvibe" };
    const task = {
      id: "task-1",
      title: "Fix notification",
      description: "debug electron hook",
      branchName: "fix-electron-notification",
      projectId: project.id,
      project,
      status: TaskStatus.PROGRESS,
      sessionType: null,
      sessionName: null,
      worktreePath: null,
      sshHost: null,
    };
    mocks.taskRepo.findOne.mockResolvedValue(task);
    mocks.taskRepo.save.mockImplementation(async (value) => value);

    const result = await updateHookTaskStatus({
      taskId: task.id,
      status: TaskStatus.REVIEW,
    });

    expect(mocks.taskRepo.findOne).toHaveBeenCalledWith({
      where: { id: task.id },
      relations: ["project"],
    });
    expect(mocks.broadcastTaskStatusChanged).toHaveBeenCalledWith({
      projectName: project.name,
      branchName: task.branchName,
      taskTitle: task.title,
      description: task.description,
      newStatus: TaskStatus.REVIEW,
      taskId: task.id,
    });
    expect(result).toEqual({
      success: true,
      data: {
        id: task.id,
        status: TaskStatus.REVIEW,
        branchName: task.branchName,
        projectName: project.name,
      },
    });
  });

  it("task 식별자가 없으면 400을 반환한다", async () => {
    const { updateHookTaskStatus } = await import("@/desktop/main/services/hookService");
    const result = await updateHookTaskStatus({
      taskId: "",
      status: TaskStatus.REVIEW,
    });

    expect(result).toEqual({
      success: false,
      error: "taskId, status는 필수입니다.",
      status: 400,
    });
  });
});

describe("hookService.startHookTask", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.taskRepo.create.mockImplementation((value) => value);
    mocks.installTaskHooksImmediately.mockResolvedValue(undefined);
  });

  it("원격 worktree task를 만들면 hooks 설치와 검증 완료를 기다린 뒤 응답한다", async () => {
    const project = {
      id: "project-1",
      repoPath: "/remote/repo",
      defaultBranch: "main",
      sshHost: "remote-host",
    };
    mocks.projectRepo.findOneBy.mockResolvedValue(project);
    mocks.createWorktreeWithSession.mockResolvedValue({
      worktreePath: "/remote/repo__worktrees/feature-task",
      sessionName: "feature-task",
    });
    mocks.taskRepo.save.mockImplementation(async (value) => ({ id: "task-1", ...value }));
    let resolveInstall!: () => void;
    mocks.installTaskHooksImmediately.mockReturnValue(new Promise<void>((resolve) => {
      resolveInstall = resolve;
    }));

    const { startHookTask } = await import("@/desktop/main/services/hookService");

    let resolved = false;
    const resultPromise = startHookTask({
      title: "remote task",
      branchName: "feature-task",
      sessionType: "tmux" as never,
      sshHost: "remote-host",
      projectId: "project-1",
    }).then((result) => {
      resolved = true;
      return result;
    });

    await flushMicrotasks();

    expect(mocks.installTaskHooksImmediately).toHaveBeenCalledWith(
      "/remote/repo__worktrees/feature-task",
      {
        id: "task-1",
        title: "remote task",
        sshHost: "remote-host",
      },
      "새 태스크 hooks 동기 설치 실패",
    );
    expect(mocks.broadcastBoardUpdate).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    resolveInstall();
    const result = await resultPromise;

    expect(mocks.broadcastBoardUpdate).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
    expect(result).toEqual({
      success: true,
      data: {
        id: "task-1",
        status: TaskStatus.PROGRESS,
        sessionName: "feature-task",
      },
    });
  });

  it("hooks 설치와 검증이 실패하면 성공 응답과 board update를 보내지 않는다", async () => {
    const project = {
      id: "project-1",
      repoPath: "/remote/repo",
      defaultBranch: "main",
      sshHost: "remote-host",
    };
    const installError = new Error("hooks verification failed");
    mocks.projectRepo.findOneBy.mockResolvedValue(project);
    mocks.createWorktreeWithSession.mockResolvedValue({
      worktreePath: "/remote/repo__worktrees/feature-task",
      sessionName: "feature-task",
    });
    mocks.taskRepo.save.mockImplementation(async (value) => ({ id: "task-1", ...value }));
    mocks.installTaskHooksImmediately.mockRejectedValue(installError);

    const { startHookTask } = await import("@/desktop/main/services/hookService");

    await expect(startHookTask({
      title: "remote task",
      branchName: "feature-task",
      sessionType: "tmux" as never,
      sshHost: "remote-host",
      projectId: "project-1",
    })).rejects.toThrow("hooks verification failed");

    expect(mocks.installTaskHooksImmediately).toHaveBeenCalledWith(
      "/remote/repo__worktrees/feature-task",
      {
        id: "task-1",
        title: "remote task",
        sshHost: "remote-host",
      },
      "새 태스크 hooks 동기 설치 실패",
    );
    expect(mocks.broadcastBoardUpdate).not.toHaveBeenCalled();
  });
});
