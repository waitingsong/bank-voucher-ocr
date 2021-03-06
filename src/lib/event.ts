import { watch } from 'fs'


import { isFileExists } from '@waiting/shared-core'
import { Observable, Observer } from 'rxjs'
import { throttleTime } from 'rxjs/operators'

import {
  Actions,
  BVOEvent,
} from './model'



export function watchFileChange(path: string, period = 3000): Observable<BVOEvent> {
  console.info(`watch file: ${path}...`)
  if (! isFileExists(path)) {
    throw new Error(`watch file not exists: "${path}"`)
  }

  const file$: Observable<BVOEvent> = Observable.create((obv: Observer<BVOEvent>) => {
    const watcher = watch(path, (eventType, filename) => {
      obv.next({
        action: Actions.fileChanged,
        payload: { eventType, filename, path },
      })
    })

    return () => watcher.close() // for unsubscribe()
  })

  return file$.pipe(
    throttleTime(period > 0 ? period : 3000),
  )
}
