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
  preProcssBufferFn?: PreProcessBufferFn,
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

      return retrieveValueByRegexp(txt, <RegexpArray> regexp)
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
function retrieveValueByRegexp(txt: string, regexps: RegexpArray): string | void {
  // console.log('---------------\n',
  // txt, '===============\n', regexps, '>>>>>>>>', regexMatch(txt, regexps))
  return regexMatch(txt, regexps)
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


export function prepareContent(buf: Buffer): string {
  let content = buf && buf.byteLength ? buf.toString() : ''

  if (! content) {
    return ''
  }
  content = content.replace(/[\t ]/g, '') // remove tab character and space character
  return content
}

/**
 * regex match with order of regexs item
 * allow only one matched result
 */
function regexMatch(content: string, regexps: RegexpArray): string | void {
  if (! content) {
    return
  }
  for (const regex of regexps) {
    const arr = content.match(regex)
    // console.log('matched:', arr, regex)

    if (Array.isArray(arr) && arr.length) {
      return arr[0]
    }
  }
}
