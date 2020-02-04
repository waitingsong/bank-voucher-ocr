import {
  FieldName, OcrRetLangMap, OcrRetTxtMap, PreProcessBufferFn, RegexpArray, ZoneRegexpOpts,
} from './model'

import { readFileAsync } from '@waiting/shared-core'
import { defer, Observable } from 'rxjs'
import { map } from 'rxjs/operators'



export function retrieveKeyValuesFromOcrResult(
  path: string, // ocr result txt file path
  matchRules: RegexpArray,
  preProcssBufferFn: PreProcessBufferFn | null,
  debug = false,
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

      return retrieveValueByRegexp(txt, regexp, debug)
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
  debug = false,
): string | void {

  const ret = regexMatch(txt, regexps, debug)
  if (debug) {
    console.info(
      `retrieveValueByRegexp ----- text start: ---------------> ${new Date()} \n`,
      txt,
      '\n<------ text END ---- regexp rules ------> \n\n',
      regexps,
      '>>>>>>>>matched value: ',
      ret,
      '\n',
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
function regexMatch(content: string, regexps: RegexpArray, debug = false): string | void {
  if (! content) {
    return
  }
  for (const regex of regexps) {
    const arr = content.match(regex)

    if (Array.isArray(arr) && arr.length) {
      if (regex.global && arr.length > 1) { // regexp with g and multi matched
        debug && console.info(
          `regexMatch ----------multi match result: --------> ${new Date()}\n`,
          arr,
          '\n--- used regex ----: ',
          regex,
          '<----ignored matched result----\n\n\n',
        )
        return ''
      }
      else {
        debug && console.info(
          `regexMatch ----------match result: --------> ${new Date()}\n`,
          arr,
          '\n--- used regex ----: ',
          regex,
          '\n\n\n',
        )
        return arr[0]
      }
    }
  }
}


export function getOcrRetLangPath(ocrRetTxtMap: OcrRetTxtMap, fieldName: FieldName, lang: string): string {
  const ocrRetLangMap = getOcrRetLangMap(ocrRetTxtMap, fieldName)

  if (! ocrRetLangMap) {
    return ''
  }
  const txtPath = ocrRetLangMap.get(lang)

  return txtPath ? txtPath : ''
}

export function updateOcrRetTxtMap(ocrRetTxtMap: OcrRetTxtMap, fieldName: FieldName, lang: string, txtPath: string) {
  if (! fieldName || ! lang || ! txtPath) {
    return
  }
  let ocrRetLangMap = getOcrRetLangMap(ocrRetTxtMap, fieldName)

  if (! ocrRetLangMap) {
    ocrRetLangMap = new Map()
  }
  if (lang && txtPath) {
    updateOcrRetLangMap(ocrRetLangMap, lang, txtPath)
  }
  ocrRetTxtMap.set(fieldName, ocrRetLangMap)
}

function updateOcrRetLangMap(ocrRetLangMap: OcrRetLangMap, lang: string, txtPath: string): void {
  ocrRetLangMap.set(lang, txtPath)
}

function getOcrRetLangMap(ocrRetTxtMap: OcrRetTxtMap, fieldName: FieldName): OcrRetLangMap | void {
  return ocrRetTxtMap.get(fieldName)
}
