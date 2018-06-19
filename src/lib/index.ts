import * as moment_ from 'moment'
import { defer, from as ofrom, of, Observable } from 'rxjs'
import {
  catchError,
  concatMap,
  defaultIfEmpty,
  delay,
  filter,
  map,
  mapTo,
  mergeMap,
  reduce,
  retry,
  skipWhile,
  take,
  tap,
 } from 'rxjs/operators'

import { createDir, isFileExists, join, rimraf, unlinkAsync } from '../shared/index'

import { initialBaseTmpDir, initialResizeImgDir, initialSplitTmpDir, zoneTmpDirPrefix } from './config'
import { resizeAndSaveImg, splitPagetoItems } from './img-process'
import {
  BankName, BankRegexpOptsMap, BatchOcrAndRetrieve,
  FieldName,
  ImgFileInfo,
  OcrFields, OcrFieldLangs, OcrLangs, OcrOpts, OcrRetInfo, OcrZone, OcrZoneRet,
  PageBankRet, PageToImgRet,
  RecognizeFieldsOpts, RecognizePageBankOpts, RegexpArray,
  SaveImgAndPruneOpts, VoucherConfig, VoucherConfigMap, ZoneImgRow, ZoneRegexpOpts,
} from './model'
import { cropImgAllZones, cropImgZone, getOcrZoneOptsByBankName, runOcr } from './ocr-process'
import { getRegexpOptsByName, prepareContent, retrieveKeyValuesFromOcrResult } from './txt-process'


const moment = moment_

export class Bvo {

  constructor(public options: OcrOpts) {
    const globalScale = +this.options.globalScale

    this.options.globalScale = Number.isNaN(globalScale) || globalScale <= 0
      ? 1
      : globalScale

    this.options.debug = !! this.options.debug

    const { baseTmpDir, splitTmpDir, resizeImgDir } = options

    const baseDir = baseTmpDir ? baseTmpDir : initialBaseTmpDir
    const splitDir = splitTmpDir ? splitTmpDir : initialSplitTmpDir
    const resizeDir = resizeImgDir ? resizeImgDir : initialResizeImgDir

    ofrom(createDir(baseDir)).pipe(
      concatMap(() => createDir(splitDir)),
      concatMap(() => createDir(resizeDir)),
    )
      .subscribe(
        () => {},
        console.error,
      )

  }

  run(imgPath: string): Observable<OcrRetInfo> {
    return recognize(imgPath, this.options)
  }
}


export function recognize(imgPath: string, options: OcrOpts): Observable<OcrRetInfo> {
  const {
    bankZone,
    baseTmpDir,
    debug,
    defaultOcrLang,
    jpegQuality,
    scale,
    splitTmpDir,
    resizeImgDir,
    voucherConfigMap,
    globalScale,
  } = options

  const baseDir = baseTmpDir ? baseTmpDir : initialBaseTmpDir
  const splitDir = splitTmpDir ? splitTmpDir : initialSplitTmpDir
  const resizeDir = resizeImgDir ? resizeImgDir : initialResizeImgDir

  // if config set for 300api, but source image from 600dpi, then set globalSale=600/300. default is 1
  const voucherConfigMapNew = parseVoucherConfigMapScale(voucherConfigMap, globalScale)
  const bankZoneNew = parseOcrZoneScale(bankZone, globalScale)
  const scaleNew = scale / globalScale
  // console.info(
  //   `global scale: "${globalScale}" result: scale:"${scaleNew}"`,
  //   '\nbankZoneNew:', bankZoneNew,
  //   '\nvoucherConfigMap:', voucherConfigMap,
  // )

  const bankRegexpOptsMap: BankRegexpOptsMap = getBankRegexpOpts(voucherConfigMapNew)
  const bankOpts = {
    baseDir,
    path: imgPath,
    bankZone: bankZoneNew,
    bankRegexpOptsMap,
    debug: !! debug,
    lang: defaultOcrLang,
  }

  const ret$ = recognizePageBank(bankOpts).pipe(
    filter(({ bankName }) => !! bankName && bankName !== BankName.NA),
    concatMap(({ bankName, pagePath }) => { // 切分页面为多张凭证
      !! debug && console.info('start split page')
      return splitPageToImgs(pagePath, bankName, splitDir, voucherConfigMapNew)
    }),
    concatMap(({ bankName, imgFile }) => { // 单张凭证处理
      const ocrFields: OcrFields | void = getOcrFields(bankName, voucherConfigMapNew)

      if (!ocrFields) {
        throw new Error(`ocrFields not defined with bankName: "${bankName}"`)
      }

      const opts = {
        bankName,
        baseDir,
        concurrent: 2,
        debug: !! debug,
        defaultValue: '',
        imgFile,
        ocrFields,
        voucherConfigMap: voucherConfigMapNew,
      }

      !! debug && console.info('recognize item')
      return <Observable<OcrRetInfo>> recognizeFields(opts).pipe(
        map(retInfo => {
          retInfo.set(FieldName.bank, bankName)
          retInfo.set('filename', imgFile.name.trim())
          retInfo.set('path', imgFile.path.trim())

          return retInfo
        }),
      )

    }),
    mergeMap(retInfo => {
      const opts = {
        retInfo,
        resizeDir,
        scale: scaleNew,
        jpegQuality,
        debug: !!debug,
      }

      return saveImgAndPrune(opts)
    }),
  )

  const imgExists$ = ofrom(isFileExists(imgPath)).pipe(
    filter(val => val),
  )

  return imgExists$.pipe(
    mergeMap(() => ret$),
  )
}


function recognizePageBank(options: RecognizePageBankOpts): Observable<PageBankRet> {
  const {
    baseDir,
    path,
    bankZone,
    bankRegexpOptsMap,
    debug,
    lang,
  } = options

  const zoneTmpDir = join(baseDir, zoneTmpDirPrefix, Math.random().toString())
  debug && console.info('recognize pageBank:', zoneTmpDir, path)

  return ofrom(createDir(zoneTmpDir)).pipe(
    mergeMap(() => cropImgZone(join(path), zoneTmpDir, bankZone)), // 切分page title区域
    concatMap(zoneInfo => { // ocr识别银行名称区域
      return runOcr(zoneInfo.path, lang).pipe(
        map(() => ({ path, zoneImgPath: zoneInfo.path })),
        mapTo(zoneInfo.path),
        catchError(() => of(zoneInfo.path)),
        // tap(() => console.info('ocr completed')),
      )
    }),
    concatMap(zoneImgPath => {
      // 批量提取参数值
      return ofrom(bankRegexpOptsMap.entries()).pipe(
        concatMap(([bankName, regexps]) => {
          return retrieveKeyValuesFromOcrResult(
            zoneImgPath + '.txt',
            regexps,
            buf => buf.toString().replace(/(?<=\S)[. ]{1,2}(?=\S)/g, ''),
            debug,
          ).pipe(
            map(val => ({ bankName, value: val })),
          )
        }),
        skipWhile(({ value }) => typeof value === 'undefined' || (typeof value === 'string' && !value.length)),
        take(1),
        map(({ bankName }) => {
          return <PageBankRet> {
            bankName,
            pagePath: path,
          }
        }),
        defaultIfEmpty({
          bankName: BankName.NA,
          pagePath: '',
        }),
      )

    }),
    tap(ret => {
      const { bankName, pagePath } = ret
      if (bankName === BankName.NA || ! pagePath) {
        // throw new Error('recognize bank of page fail. no matached regexp')
        console.info(`recognize bank of page fail. no matached regexp. file: "${path}", pagePath: "${pagePath}" `)
      }
      debug || rimraf(zoneTmpDir).catch(console.info)
    }),
  )

}


// 切分页面为多张凭证
function splitPageToImgs(
  pagePath: string,
  bankName: BankName,
  targetDir: string,
  voucherConfigMap: VoucherConfigMap,
): Observable<PageToImgRet> {
  const config = voucherConfigMap.get(bankName)

  if (!config) {
    throw new Error('bank config empty during split page to images')
  }

  return splitPagetoItems(pagePath, targetDir, config).pipe(
    mergeMap(fileMap => {
      const ret$: Observable<PageToImgRet> = ofrom(fileMap.values()).pipe(
        map(imgFile => {
          return { bankName, imgFile }
        }),
      )
      return ret$
    }),
  )
}


// 识别区域图片提取指定字段值
function recognizeFields(options: RecognizeFieldsOpts): Observable<OcrRetInfo> {
  const {
    bankName,
    baseDir,
    concurrent,
    debug,
    defaultValue,
    imgFile,
    ocrFields,
    voucherConfigMap,
  } = options

  const zoneTmpDir = join(baseDir, zoneTmpDirPrefix, moment().format('YYYYMMDD') + '-' + Math.random().toString())
  const bankConfig = getOcrZoneOptsByBankName(bankName, voucherConfigMap)

  if (! bankConfig) {
    throw new Error(`get bankConfig empty with bankName: "${bankName}"`)
  }

  const stream$: Observable<OcrRetInfo> = ofrom(createDir(zoneTmpDir)).pipe(
    mergeMap(() => cropImgAllZones(imgFile.path, zoneTmpDir, bankConfig.ocrZones)), // 切分图片区域分别做ocr识别
    concatMap(fileMap => {
      const opts: BatchOcrAndRetrieve = {
        bankConfig, ocrFields, defaultValue, debug,
        concurrent: concurrent > 0 ? concurrent : 2,
        zoneImgMap: fileMap,
      }
      return batchOcrAndRetrieve(opts)
    }),
    // do NOT delete zoneTmpDir here
  )

  return stream$
}

function batchOcrAndRetrieve(options: BatchOcrAndRetrieve): Observable<OcrRetInfo> {
  const {
    zoneImgMap,
    bankConfig,
    ocrFields,
    defaultValue,
    concurrent,
    debug,
  } = options

  const { bankName } = bankConfig

  const del$ = ofrom(zoneImgMap.entries()).pipe(
    delay(5000),
    mergeMap(([, imgInfo]) => {
      return defer(async () => {
        const img = imgInfo.path
        const txt = img + '.txt'

        if (await isFileExists(img)) {
          await rimraf(img)
        }
        if (await isFileExists(txt)) {
          await rimraf(txt)
        }
        return null
      }).pipe(
        delay(20000),
        retry(2),
        catchError(err => {
          console.info('Delete zone file retry failed:', err)
          return of(null)
        }),
      )
    }),
    catchError(() => {
      return of(null)
    }),
  )

  const process$ = ofrom(zoneImgMap.entries()).pipe(
    concatMap((zoneImgRow: ZoneImgRow) => {
      return ocrAndPickFromZoneImg(zoneImgRow, bankConfig, concurrent, debug)
    }),
    reduce<OcrZoneRet, OcrRetInfo>((acc, curr) => acc.set(curr.fieldName, curr.value), new Map()),
    map(retMap => retMap.set(FieldName.bank, bankName)),
    map(retMap => setDefaultValue(retMap, ocrFields, defaultValue)),
    tap(() => debug || del$.subscribe()), // 删除zone切分图片
  )

  return process$
}


function setDefaultValue(info: OcrRetInfo, ocrFields: OcrFields, defaultValue: string = ''): OcrRetInfo {
  const ret: OcrRetInfo = new Map()

  for (const fld of Object.keys(ocrFields)) {
    const value = info.get(<FieldName> fld)

    if (typeof value === 'string') {
      ret.set(<FieldName> fld, value)
    }
    else {
      ret.set(<FieldName> fld, '')
    }
  }

  return ret
}


function processZoneImgRow(zoneRet: OcrZoneRet): OcrZoneRet {
  const { fieldName, value } = zoneRet
  const ret = <OcrZoneRet> { fieldName, value }

  switch (fieldName) {
    case FieldName.amount:
      ret.value = value.trim().replace(/,/g, '')
      break

    case FieldName.date:
      ret.value = value.trim().replace(/\D/g, '') // YYYYMMDD
      break

    case FieldName.sn:
      ret.value = value.trim()
      break
  }

  return ret
}


function validateZoneImgRow(fieldName: FieldName, value: string | void): boolean {
  if (typeof value !== 'string') {
    return false
  }

  switch (fieldName) {
    case FieldName.amount:
      if (validateRetInfoAmout(value)) {
        return true
      }
      break

    case FieldName.sn:
      if (value) {
        return true
      }
      break

    case FieldName.date:
      if (validateRetInfoDate(value)) {
        return true
      }
      break

    case FieldName.bank:
      return true // here bank is blank

    default:
      if (typeof value === 'string') {
        return true
      }
      break
  }

  return false
}


function validateRetInfoAmout(value: string | void): boolean {
  if (! value) {
    return false
  }
  if (! value.trim()) {
    return false
  }
  const vv = parseFloat(value)
  if (Number.isNaN(vv)) {
    return false
  }
  if (typeof vv === 'number') {
    return true
  }
  return false
}

function validateRetInfoDate(value: string | void): boolean {
  if (! value) {
    return false
  }
  return moment(value, 'YYYYMMDD').isValid()
}


function getBankRegexpOpts(configMap: VoucherConfigMap): BankRegexpOptsMap {
  const ret: BankRegexpOptsMap = new Map()

  for (const { bankName, regexpOpts } of configMap.values()) {
    if (regexpOpts && regexpOpts.bank) {
      ret.set(bankName, regexpOpts.bank)
    }
  }
  if (! ret.size) {
    throw new Error('not BankRegexpOpts found, should not set')
  }

  return ret
}


function getOcrFields(bankName: BankName, configMap: VoucherConfigMap): OcrFields | void {
  const config = configMap.get(bankName)

  if (! config) {
    throw new Error(`get ocrFields empty by bankName: "${bankName}"`)
  }
  return config.ocrFields
}


function saveImgAndPrune(options: SaveImgAndPruneOpts): Observable<OcrRetInfo> {
  const { retInfo, resizeDir, debug, scale, jpegQuality } = options

  const filename = retInfo.get('filename')
  const path = retInfo.get('path')
  const sn = retInfo.get(FieldName.sn)

  if (!filename) {
    throw new Error(`result info map invalid with empty path. info: ${retInfo}`)
  }
  if (!path) {
    throw new Error(`result info map invalid with empty path. info: ${retInfo}`)
  }
  const filename2 = sn ? `${ new Date().getTime() }-${sn.replace(/[^\d\w]/g, '_')}.jpg` : filename
  const curDate = moment().format('YYYY-MM-DD')
  const targetPath = join(
    resizeDir,
    curDate,
    filename2,
  )

  retInfo.set('filename', filename2)

  return resizeAndSaveImg(path, targetPath, scale, jpegQuality).pipe(
    map(imgInfo => {
      retInfo.set('path', imgInfo.path)
      return retInfo
    }),
    tap(() => {
      debug || unlinkAsync(path).catch(console.info)
    }),
  )

}


function genFieldLangs(
  fieldName: FieldName,
  defaultLangs: OcrLangs,
  fieldLangs: Partial<OcrFieldLangs> | void,
): OcrLangs {
  if (fieldLangs && typeof fieldLangs[fieldName] !== 'undefined' && Array.isArray(fieldLangs[fieldName])) {
    return <OcrLangs> fieldLangs[fieldName]
  }
  return defaultLangs
}


function ocrAndPickFromZoneImg(
  zoneImgRow: ZoneImgRow,
  config: VoucherConfig,
  concurrent: number = 2,
  debug: boolean = false,
): Observable<OcrZoneRet> {

  const { ocrDefaultLangs, ocrFieldLangs, regexpOpts, ocrFields } = config

  return ofrom(Object.entries(ocrFields)).pipe(
    filter(data => {
      const zoneName: FieldName | void = data[1]
      return !! zoneName && zoneName === zoneImgRow[0]
    }),
    mergeMap(data => {
      const fieldName = <FieldName> data[0]
      return ocrAndPickFieldFromZoneImg(
        fieldName,
        zoneImgRow,
        regexpOpts,
        ocrDefaultLangs,
        ocrFieldLangs,
        debug,
      )
    }, concurrent),
  )

}


function ocrAndPickFieldFromZoneImg(
  fieldName: FieldName,
  zoneImgRow: ZoneImgRow,
  regexpOpts: ZoneRegexpOpts,
  defaultLangs: OcrLangs,
  fieldLangs: Partial<OcrFieldLangs> | void,
  debug: boolean = false,
): Observable<OcrZoneRet> {

  const [, zoneImg] = zoneImgRow
  const langs = genFieldLangs(fieldName, defaultLangs, fieldLangs)
  const maxLangIndex = langs.length - 1
  const regexp: RegexpArray | void = getRegexpOptsByName(fieldName, regexpOpts)  // fieldKey, not fieldName !

  if (!regexp) {
    throw new Error(`got regexp empty by zoneName: "${fieldName}"`)
  }

  // console.info(`lop langs:----field: ${fieldName}:`, langs)
  return ofrom(langs).pipe(
    // MUST concatMap
    concatMap<string, ZoneImgRow>(lang => {
      // console.log(`fld "${fieldName}" use lang:`, lang, zoneImg.path)
      return runOcr(zoneImg.path, lang).pipe(
        mapTo(true),
        catchError(() => of(true)),  // tesseract will exit with code(0) but out by stderr
      )
    }),

    concatMap(() => {
      return retrieveKeyValuesFromOcrResult(
        zoneImg.path + '.txt',
        regexp,
        prepareContent,
        debug,
      ).pipe(
        map(val => ({ fieldName, value: val })),
      )

    }),

    skipWhile((data, index) => {
      const valid = validateZoneImgRow(data.fieldName, data.value)
      return !valid && index !== maxLangIndex
    }),

    take(1),

    map(data => {
      if (typeof data.value !== 'string') {
        data.value = ''
      }
      return <OcrZoneRet> data
    }),

    map(processZoneImgRow),
  )

}


// parse width,height with globalScale
function parseVoucherConfigMapScale(configMap: VoucherConfigMap, globalScale: number): VoucherConfigMap {
  const ret = <VoucherConfigMap> new Map()

  for (const [bankName, config] of configMap) {
    const ocrZones = <OcrZone[]> []

    for (const zone of config.ocrZones) {
      ocrZones.push(parseOcrZoneScale(zone, globalScale))
    }
    config.ocrZones = ocrZones
    config.width = config.width * globalScale
    config.height = config.height * globalScale

    ret.set(bankName, config)
  }

  return ret
}

// parse width,height with globalScale
function parseOcrZoneScale(config: OcrZone, globalScale: number): OcrZone {
  const ret = <OcrZone> { ...config }

  ret.width = ret.width * globalScale
  ret.height = ret.height * globalScale
  ret.offsetX = ret.offsetX * globalScale
  ret.offsetY = ret.offsetY * globalScale

  return ret
}
