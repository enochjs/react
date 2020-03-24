/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactPriorityLevel} from './SchedulerWithReactIntegration';

import {MAX_SIGNED_31_BIT_INT} from './MaxInts';

import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  IdlePriority,
} from './SchedulerWithReactIntegration';

export type ExpirationTime = number;

export const NoWork = 0;
// TODO: Think of a better name for Never. The key difference with Idle is that
// Never work can be committed in an inconsistent state without tearing the UI.
// The main example is offscreen content, like a hidden subtree. So one possible
// name is Offscreen. However, it also includes dehydrated Suspense boundaries,
// which are inconsistent in the sense that they haven't finished yet, but
// aren't visibly inconsistent because the server rendered HTML matches what the
// hydrated tree would look like.
export const Never = 1;
// Idle is slightly higher priority than Never. It must completely finish in
// order to be consistent.
export const Idle = 2;
// Continuous Hydration is slightly higher than Idle and is used to increase
// priority of hover targets.
export const ContinuousHydration = 3;

// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
// export default 1073741823;
export const Sync = MAX_SIGNED_31_BIT_INT;
export const Batched = Sync - 1;

const UNIT_SIZE = 10;
const MAGIC_NUMBER_OFFSET = Batched - 1;

// 1 unit of expiration time represents 10ms.
export function msToExpirationTime(ms: number): ExpirationTime {
  // Always subtract from the offset so that we don't clash with the magic number for NoWork.
  return MAGIC_NUMBER_OFFSET - ((ms / UNIT_SIZE) | 0);
}

export function expirationTimeToMs(expirationTime: ExpirationTime): number {
  return (MAGIC_NUMBER_OFFSET - expirationTime) * UNIT_SIZE;
}

// 其实就是向上取整，不过取整的单位是 precision (余数在 0 <= x < precision, 都为 precision， 相当于 num = （num/precision）* precision + precision)
function ceiling(num: number, precision: number): number {
  return (((num / precision) | 0) + 1) * precision;
}

// MAGIC_NUMBER_OFFSET - 
// （MAGIC_NUMBER_OFFSET - currentTime + expirationInMs / UNIT_SIZE） 以（bucketSizeMs/UNIT_SIZE）LOW_PRIORITY_BATCH_SIZE 25. HIGH_PRIORITY_BATCH_SIZE 10为单位 向上取整的值
// 
// low: 
// 0 <= x < 25, x为补数，让（(MAGIC_NUMBER_OFFSET - currentTime + 500) + x）能整除25
// x 尾数的作用是，可以让25ms以内产生的work的expirationTime是一样的
// 结果就是  MAGIC_NUMBER_OFFSET - (MAGIC_NUMBER_OFFSET - currentTime + 500 + x)
// MAGIC_NUMBER_OFFSET - MAGIC_NUMBER_OFFSET + currentTime - 500 + x
// currentTime - 500 + x
// currentTime 是由 performance.now() 产生的，所以自浏览器start开始，越是后面的fiber ExpirationTime 越大

// heigh 也是一样   0 =< x < 10
// 结果就是  MAGIC_NUMBER_OFFSET - (MAGIC_NUMBER_OFFSET - currentTime + 15 + x)
// currentTime - 15 + x
function computeExpirationBucket(
  currentTime,
  expirationInMs,
  bucketSizeMs,
): ExpirationTime {
  return (
    MAGIC_NUMBER_OFFSET -
    ceiling(
      MAGIC_NUMBER_OFFSET - currentTime + expirationInMs / UNIT_SIZE,
      bucketSizeMs / UNIT_SIZE,
    )
  );
}

// TODO: This corresponds to Scheduler's NormalPriority, not LowPriority. Update
// the names to reflect.
export const LOW_PRIORITY_EXPIRATION = 5000;
export const LOW_PRIORITY_BATCH_SIZE = 250;

export function computeAsyncExpiration(
  currentTime: ExpirationTime,
): ExpirationTime {
  return computeExpirationBucket(
    currentTime,
    LOW_PRIORITY_EXPIRATION,
    LOW_PRIORITY_BATCH_SIZE,
  );
}

export function computeSuspenseExpiration(
  currentTime: ExpirationTime,
  timeoutMs: number,
): ExpirationTime {
  // TODO: Should we warn if timeoutMs is lower than the normal pri expiration time?
  return computeExpirationBucket(
    currentTime,
    timeoutMs,
    LOW_PRIORITY_BATCH_SIZE,
  );
}

// We intentionally set a higher expiration time for interactive updates in
// dev than in production.
//
// If the main thread is being blocked so long that you hit the expiration,
// it's a problem that could be solved with better scheduling.
//
// People will be more likely to notice this and fix it with the long
// expiration time in development.
//
// In production we opt for better UX at the risk of masking scheduling
// problems, by expiring fast.
export const HIGH_PRIORITY_EXPIRATION = __DEV__ ? 500 : 150;
export const HIGH_PRIORITY_BATCH_SIZE = 100;

export function computeInteractiveExpiration(currentTime: ExpirationTime) {
  return computeExpirationBucket(
    currentTime,
    HIGH_PRIORITY_EXPIRATION,
    HIGH_PRIORITY_BATCH_SIZE,
  );
}


// export const ImmediatePriority: ReactPriorityLevel = 99;
// export const UserBlockingPriority: ReactPriorityLevel = 98;
// export const NormalPriority: ReactPriorityLevel = 97;
// export const LowPriority: ReactPriorityLevel = 96;
// export const IdlePriority: ReactPriorityLevel = 95;
// // NoPriority is the absence of priority. Also React-only.
// export const NoPriority: ReactPriorityLevel = 90;
// 看起来是用来提升优先级用的，理解上就是让高优先级的先调用，防止饿死现象，根据时间不停提升低优先级的优先级
export function inferPriorityFromExpirationTime(
  currentTime: ExpirationTime,
  expirationTime: ExpirationTime,
): ReactPriorityLevel {
  if (expirationTime === Sync) {
    return ImmediatePriority;
  }
  if (expirationTime === Never || expirationTime === Idle) {
    return IdlePriority;
  }

  // export function msToExpirationTime(ms: number): ExpirationTime {
  //   return MAGIC_NUMBER_OFFSET - ((ms / UNIT_SIZE) | 0);
  // }
  
  // export function expirationTimeToMs(expirationTime: ExpirationTime): number {
  //   return (MAGIC_NUMBER_OFFSET - expirationTime) * UNIT_SIZE;
  // }

  // heigh
  // MAGIC_NUMBER_OFFSET - (initCurrentTime - 15 + x) - (MAGIC_NUMBER_OFFSET - currentTime)
  // (currentTime - initCurrentTime + 15 - x) * 10
  // msUntil < 0 说明已经到过期时间了，提升优先级 为ImmediatePriority
  const msUntil = expirationTimeToMs(expirationTime) - expirationTimeToMs(currentTime);
  if (msUntil <= 0) {
    return ImmediatePriority;
  }
  // 设置为高优先级
  if (msUntil <= HIGH_PRIORITY_EXPIRATION + HIGH_PRIORITY_BATCH_SIZE) {
    return UserBlockingPriority;
  }
  // 设置为高低先级
  if (msUntil <= LOW_PRIORITY_EXPIRATION + LOW_PRIORITY_BATCH_SIZE) {
    return NormalPriority;
  }

  // TODO: Handle LowPriority

  // Assume anything lower has idle priority
  return IdlePriority;
}
