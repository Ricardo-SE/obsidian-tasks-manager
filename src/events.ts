/**
 * 极简事件总线
 * 内部用：索引刷新后通知视图重画。MVP 不对外暴露
 */
type Handler = () => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  emit(event: string): void {
    this.handlers.get(event)?.forEach((h) => h());
  }
}
