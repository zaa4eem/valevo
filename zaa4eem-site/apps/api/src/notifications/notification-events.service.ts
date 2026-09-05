import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

export interface NotificationEvent {
  userId: string;
  unreadCount: number;
}

/**
 * In-process fan-out so an open browser tab hears about a new notification
 * the moment it's created, instead of finding out on the next page load.
 *
 * Deliberately in-memory: with a single API process that's all it takes, and
 * a dropped event is harmless — the client re-reads the real unread count
 * from the database whenever it (re)connects, so the stream is a nudge, never
 * the source of truth. Running more than one API instance would need this
 * swapped for Redis pub/sub; the interface wouldn't change.
 */
@Injectable()
export class NotificationEventsService {
  private readonly stream$ = new Subject<NotificationEvent>();

  publish(event: NotificationEvent) {
    this.stream$.next(event);
  }

  forUser(userId: string): Observable<NotificationEvent> {
    return this.stream$.pipe(
      filter((event) => event.userId === userId),
      map((event) => event),
    );
  }
}
