import { defer, Observable } from 'rxjs'
import {
  map,
} from 'rxjs/operators'

import { readFileAsync } from '../shared/index'

import {
  FieldName, PreProcessBufferFn, RegexpArray, ZoneRegexpOpts,
} from './model'



export function retrieveKeyValuesFromOcrResult(
  path: string, // ocr result txt file path
  matchRules: RegexpArray,
  preProcssBufferFn: PreProcessBufferFn | null,
  debug: boolean = false,
): Observable<string | void> {

  if (! matchRules) {
    throw new Error('matchRules empty')
  }

  return readTxtFile(path).pipe(
    map(buf => ({ buf, regexp: matchRules })),
    map(({ buf, regexp }) => {
      const txt = preProcssBufferFn && typeof preProcssBufferFn === 'function'
        ? preProcssBufferFn(buf)
        : buf.toString('utf8')

      return retrieveValueByRegexp(txt, <RegexpArray> regexp, debug)
    }),
    // map(val => typeof val === 'string' && val.length > 0 ? val : ''),
  )

}



/**
 * get ocrRegexpOpts of specified zoneName
 * use default 'all' if not matched
 */
export function getRegexpOptsByName(
  fieldName: FieldName,
  ocrRegexpOpts: ZoneRegexpOpts,
): RegexpArray | void {

  for (const key of Object.keys(ocrRegexpOpts)) {
    if (key === fieldName) {
      return ocrRegexpOpts[key]
    }
  }
}


// retrieve fieldName from ocr result file
function retrieveValueByRegexp(
  txt: string,
  regexps: RegexpArray,
  debug: boolean = false,
): string | void {

  const ret = regexMatch(txt, regexps, debug)
  if (debug) {
    console.info(
      'retrieveValueByRegexp ----- text start: ---------------> \n',
      txt, '\n<--------------- text END ----------------\n\n',
      regexps, '>>>>>>>>matched value: ',
      ret, '\n',
    )
  }
  return ret
}


function readTxtFile(path: string): Observable<Buffer> {
  if (! path) {
    throw new Error('path empty')
  }

  const pathArr = path.split('.')
  if (pathArr.length > 1 && pathArr[pathArr.length - 1].toLowerCase() !== 'txt') {
    throw new Error(`file extensiion must empty or be '.txt', but is: "${path}"`)
  }

  return defer(async () => readFileAsync(path))
}


// default text parse
export function prepareContent(buf: Buffer): string {
  let content = buf && buf.byteLength ? buf.toString() : ''

  if (! content) {
    return ''
  }
  content = content.replace(/(?<=\S) /g, '') // remove ONE space character after word
  return content
}

/**
 * regex match with order of regexs item
 * allow only one matched result
 */
function regexMatch(content: string, regexps: RegexpArray, debug: boolean = false): string | void {
  if (! content) {
    return
  }
  for (const regex of regexps) {
    const arr = content.match(regex)

    if (Array.isArray(arr) && arr.length) {
      if (regex.global && arr.length > 1) { // regexp with g and multi matched
        debug && console.info(
          '----------multi matched regex: -------------->\n',
          arr, '\n--- used regex ----: ', regex,
          '\n<-------------ignore matched result---------------\n\n',
        )
        return ''
      }
      else {
        debug && console.info(
          '----------matched regex: -------------->\n',
          arr, '\n--- used regex ----: ', regex,
          '\n<----------------------------\n\n',
        )
        return arr[0]
      }
    }
  }
}
