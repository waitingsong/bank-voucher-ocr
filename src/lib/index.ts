import * as moment_ from 'moment'
import { cpus } from 'os'
import { defer, from as ofrom, of, Observable } from 'rxjs'
import {
  catchError,
  concatMap,
  defaultIfEmpty,
  filter,
  map,
  mapTo,
  mergeMap,
  reduce,
  skipWhile,
  take,
  tap,
 } from 'rxjs/operators'

import {
  basename,
  copyFileAsync,
  createDir,
  isFileExists,
  isPathAcessible,
  join,
  rimraf,
  unlinkAsync,
} from '../shared/index'

import { initialBaseTmpDir, initialResizeImgDir, initialSplitTmpDir, zoneTmpDirPrefix } from './config'
import { readImgInfo, resizeAndSaveImg, splitPagetoItems } from './img-process'
import {
  BankName, BankRegexpOptsMap, BatchOcrAndRetrieve,
  FieldName,
  OcrFields, OcrFieldLangs, OcrLangs, OcrOpts, OcrRetInfo, OcrRetInfoKey, OcrRetTxtMap, OcrZone, OcrZoneRet,
  PageBankRet, PageToImgRet,
  RecognizeFieldsOpts, RecognizePageBankOpts, RegexpArray,
  SaveImgAndPruneOpts, VoucherConfig, VoucherConfigMap, ZoneImgRow, ZoneRegexpOpts,
} from './model'
import { cropImgAllZones, cropImgZone, getOcrZoneOptsByBankName, runOcr } from './ocr-process'
import {
  getOcrRetLangPath,
  getRegexpOptsByName,
  prepareContent,
  retrieveKeyValuesFromOcrResult,
  updateOcrRetTxtMap,
} from './txt-process'


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

    defer(() => createDir(baseDir)).pipe(
      catchError(err => {
        console.info(err)
        return of(null)
      }),
      concatMap(() => createDir(splitDir)),
      catchError(err => {
        console.info(err)
        return of(null)
      }),
      concatMap(() => createDir(resizeDir)),
      catchError(err => {
        console.info(err)
        return of(null)
      }),
    )
      .subscribe(
        () => {},
        console.error,
      )

  }

  run(imgPath: string): Observable<OcrRetInfo> {
    const {
      debug,
      jpegQuality,
      scale,
      resizeImgDir,
      globalScale,
    } = this.options

    const resizeDir = resizeImgDir ? resizeImgDir : initialResizeImgDir
    const scaleNew = scale / globalScale
    const options = {
      resizeDir,
      scale: scaleNew,
      jpegQuality,
      debug: !!debug,
    }

    return recognize(imgPath, this.options).pipe(
      mergeMap((retInfo: OcrRetInfo) => {
        const opts: SaveImgAndPruneOpts = {
          retInfo,
          ...options,
        }
        return saveImgAndPrune(opts)
      }),
    )
  }
}


/** 处理单个文件图片 */
export function recognize(imgPath: string, options: OcrOpts): Observable<OcrRetInfo> {
  const {
    bankName: inputBankName,
    bankZone,
    baseTmpDir,
    concurrent,
    debug,
    defaultOcrLang,
    isSingleVoucher,
    splitTmpDir,
    voucherConfigMap,
    globalScale,
    skipImgDir,
  } = options

  const baseDir = baseTmpDir ? baseTmpDir : initialBaseTmpDir
  const splitDir = splitTmpDir ? splitTmpDir : initialSplitTmpDir
  const skipDir = skipImgDir ? join(skipImgDir, moment().format('YYYYMMDD')) : ''
  const cnumber = typeof concurrent === 'number' && concurrent > 0 ? concurrent : cpus().length

  // if config set for 300api, but source image from 600dpi, then set globalSale=600/300. default is 1
  const voucherConfigMapNew = parseVoucherConfigMapScale(voucherConfigMap, globalScale)
  const bankZoneNew = parseOcrZoneScale(bankZone, globalScale)

  const bankRegexpOptsMap: BankRegexpOptsMap = getBankRegexpOpts(voucherConfigMapNew)
  const bankOpts = {
    baseDir,
    path: imgPath,
    bankZone: bankZoneNew,
    bankRegexpOptsMap,
    debug: !! debug,
    lang: defaultOcrLang,
    skipImgDir: skipDir,
  }

  const bank$: Observable<PageBankRet> = !inputBankName
    ? recognizePageBank(bankOpts)
    : of(<PageBankRet> {
      bankName: inputBankName,
      pagePath: imgPath,
    })

  const ret$ = bank$.pipe(
    filter(({ bankName }) => !! bankName && bankName !== BankName.NA),
    mergeMap(({ bankName, pagePath }) => { // 切分页面为多张凭证
      if (isSingleVoucher) {
        return readImgInfo(pagePath).pipe(
          map(imgInfo => {
            return of(<PageToImgRet> {
              bankName,
              imgFile: imgInfo,
            })
          }),
        )
      }
      else {
        !!debug && console.info('start split page')
        return splitPageToImgs(pagePath, bankName, splitDir, voucherConfigMapNew)
      }
    }),
    mergeMap(({ bankName, imgFile }) => { // 单张凭证处理
      const ocrFields: OcrFields | void = getOcrFields(bankName, voucherConfigMapNew)

      if (!ocrFields) {
        throw new Error(`ocrFields not defined with bankName: "${bankName}"`)
      }

      const opts = {
        bankName,
        baseDir,
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
          retInfo.set(OcrRetInfoKey.filename, imgFile.name.trim())
          retInfo.set(OcrRetInfoKey.path, imgFile.path.trim())

          return retInfo
        }),
      )
    }, cnumber > 0 ? cnumber : 1),
  )

  const imgExists$ = defer(() => isFileExists(imgPath)).pipe(
    filter(val => val),
  )

  return imgExists$.pipe(
    mergeMap(() => ret$),
  )
}


export function recognizePageBank(options: RecognizePageBankOpts): Observable<PageBankRet> {
  const {
    baseDir,
    path,
    bankZone,
    bankRegexpOptsMap,
    debug,
    lang,
    skipImgDir, // with YYYYMMDD subfolder
  } = options

  const zoneTmpDir = join(baseDir, zoneTmpDirPrefix, `${ basename(path) }-${ Math.random().toString() }`)
  debug && console.info('recognize pageBank:', zoneTmpDir, path)

  return defer(() => createDir(zoneTmpDir)).pipe(
    catchError(err => {
      console.info(err)
      return of(null)
    }),
    mergeMap(() => cropImgZone(join(path), zoneTmpDir, bankZone)), // 切分page title区域
    concatMap(zoneInfo => { // ocr识别银行名称区域
      return runOcr(zoneInfo.path, lang, zoneInfo.path).pipe(
        mapTo(zoneInfo.path),
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
            buf => buf.toString().replace(/(?<=\S)[. ]{1,2}(?=\S)/g, '').replace(/\n{2,}/g, ''),
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
        cpSkipImg(path, skipImgDir)
      }
      debug || rimraf(zoneTmpDir).catch(console.info)
    }),
  )

}


async function cpSkipImg(srcPath: string, skipImgDir: string | void) {
  if (! skipImgDir) {
    return
  }
  if (! await isPathAcessible(skipImgDir)) {
    await createDir(skipImgDir)
  }
  copyFileAsync(srcPath, join(skipImgDir, basename(srcPath))).catch(console.error)
}


/** 切分页面为多张凭证 */
export function splitPageToImgs(
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


/** 识别区域图片提取指定字段值 */
export function recognizeFields(options: RecognizeFieldsOpts): Observable<OcrRetInfo> {
  const {
    bankName,
    baseDir,
    debug,
    defaultValue,
    imgFile,
    ocrFields,
    voucherConfigMap,
  } = options

  const zoneTmpDir = join(
    baseDir,
    zoneTmpDirPrefix,
    `${ basename(imgFile.path) }`,
  )
  const bankConfig = getOcrZoneOptsByBankName(bankName, voucherConfigMap)

  if (! bankConfig) {
    throw new Error(`get bankConfig empty with bankName: "${bankName}"`)
  }

  const stream$: Observable<OcrRetInfo> = defer(() => createDir(zoneTmpDir)).pipe(
    // 切分图片区域分别做ocr识别
    mergeMap(() => cropImgAllZones(imgFile.path, zoneTmpDir, ocrFields, bankConfig.ocrZones)),
    concatMap(fileMap => {
      const opts: BatchOcrAndRetrieve = {
        bankConfig, ocrFields, defaultValue, debug,
        zoneImgMap: fileMap,
      }
      return batchOcrAndRetrieve(opts)
    }),
    tap(() => {
      if (! debug) {
        setTimeout(dir => {
          rimraf(dir).catch(console.info)
        }, 5000, zoneTmpDir)
      }
    }),
  )

  return stream$
}

/** 批量识别提取 */
export function batchOcrAndRetrieve(options: BatchOcrAndRetrieve): Observable<OcrRetInfo> {
  const {
    zoneImgMap,
    bankConfig,
    ocrFields,
    defaultValue,
    debug,
  } = options

  const { bankName } = bankConfig
  const process$ = ofrom(zoneImgMap.entries()).pipe(
    concatMap((zoneImgRow: ZoneImgRow) => {
      return ocrAndPickFromZoneImg(zoneImgRow, bankConfig, debug)
    }),
    reduce<OcrZoneRet, OcrRetInfo>((acc, curr) => acc.set(curr.fieldName, curr.value), new Map()),
    map(retMap => retMap.set(FieldName.bank, bankName)),
    map(retMap => setDefaultValue(retMap, ocrFields, defaultValue)),
    // tap(() => debug || del$.subscribe()), // 删除zone切分图片
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
  const ret: OcrZoneRet = { ...zoneRet }

  switch (fieldName) {
    case FieldName.amount:
      ret.value = value.trim().replace(/,/g, '')
      break

    case FieldName.date:
      ret.value = value.trim().replace(/\D/g, '') // YYYYMMDD
      if (ret.value && ret.value.slice(0, 1) === '0') {
        ret.value = '2' + ret.value
      }
      break

    case FieldName.sn:
      ret.value = value.trim()
      break

    case FieldName.destAccountNumber:
      ret.value = value.trim()
      break

    case FieldName.paymentAccountNumber:
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

  const filename = retInfo.get(OcrRetInfoKey.filename)
  const path = retInfo.get(OcrRetInfoKey.path)
  const sn = retInfo.get(FieldName.sn)

  if (!filename) {
    throw new Error(`result info map invalid with empty path. info: ${retInfo}`)
  }
  if (!path) {
    throw new Error(`result info map invalid with empty path. info: ${retInfo}`)
  }
  // YYYYMMDD-A15295623630009-0.31486898522590034-pageSplitItemIndex.jpg
  const arr = filename.split('.').slice(0, -1).join('').split('-')
  arr.splice(2, 1)
  let filename2 = arr.join('-')

  if (sn) {
    filename2 = filename2 + `-${sn.replace(/[^\d\w]/g, '_')}`
  }
  filename2 = filename2 + '.jpg'

  const curDate = moment().format('YYYY-MM-DD')
  const targetPath = join(
    resizeDir,
    curDate,
    filename2,
  )

  retInfo.set(OcrRetInfoKey.filename, filename2)

  return resizeAndSaveImg(path, targetPath, scale, jpegQuality).pipe(
    map(imgInfo => {
      retInfo.set(OcrRetInfoKey.path, imgInfo.path)
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


/** 处理单张zone图片做识别提取 */
export function ocrAndPickFromZoneImg(
  zoneImgRow: ZoneImgRow,
  config: VoucherConfig,
  debug: boolean = false,
): Observable<OcrZoneRet> {

  const { ocrDefaultLangs, ocrFieldLangs, regexpOpts, ocrFields } = config
  const ocrRetTxtMap = <OcrRetTxtMap> new Map()

  return ofrom(Object.entries(ocrFields)).pipe(
    filter(data => {
      const zoneName: FieldName | void = data[1]
      return !! zoneName && zoneName === zoneImgRow[0]
    }),
    concatMap(data => {
      const fieldName = <FieldName> data[0]
      const zoneName = <FieldName> data[1]
      return ocrAndPickFieldFromZoneImg(
        fieldName,
        zoneName,
        zoneImgRow,
        regexpOpts,
        ocrDefaultLangs,
        ocrFieldLangs,
        debug,
        ocrRetTxtMap,
      )
    }),
  )

}


function ocrAndPickFieldFromZoneImg(
  fieldName: FieldName,
  zoneName: FieldName,
  zoneImgRow: ZoneImgRow,
  regexpOpts: ZoneRegexpOpts,
  defaultLangs: OcrLangs,
  fieldLangs: Partial<OcrFieldLangs> | void,
  debug: boolean = false,
  ocrRetTxtMap: OcrRetTxtMap,
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
    concatMap(lang => {
      // console.info(`\n\n\nfld "${fieldName}" zoneName: "${zoneName}" use lang: ${lang}, path: "${zoneImg.path}"\n`)
      const path = getOcrRetLangPath(ocrRetTxtMap, zoneName, lang)

      if (path) {
        // console.info(`reused txtPath. fieldName: "${fieldName}", zoneName: "${zoneName}", lang: "${lang}",
        //   txtPath: "${path}"\n\n`)
        return retrieveKeyValuesFromOcrResult(
          path + '.txt',
          regexp,
          prepareContent,
          debug,
        ).pipe(
          map(val => {
            return <OcrZoneRet> {
              fieldName,
              zoneName,
              value: val,
              usedLang: lang,
              txtPath: path,
            }
          }),
        )

      }
      else {
        const imgPath = zoneImg.path
        const txtPath = imgPath.split('.').slice(0, -1).join('.') + `-${Math.random()}`

        return runOcr(imgPath, lang, txtPath).pipe(
          concatMap(() => {
            // console.info(`\n\n--------- usedLang: "${lang}", txtPath:"${txtPath}"`)
            return retrieveKeyValuesFromOcrResult(
              txtPath + '.txt',
              regexp,
              prepareContent,
              debug,
            ).pipe(
              map(val => {
                return <OcrZoneRet> {
                  fieldName,
                  zoneName,
                  value: val,
                  usedLang: lang,
                  txtPath,
                }
              }),
            )

          }),
        )
      }

    }),

    tap(({ zoneName: zone, usedLang, txtPath }) => {
      updateOcrRetTxtMap(ocrRetTxtMap, zone, usedLang, txtPath)
    }),

    skipWhile((data: OcrZoneRet, index: number) => {
      const valid = validateZoneImgRow(data.fieldName, data.value)
      return !valid && index !== maxLangIndex
    }),

    take(1),

    map(data => {
      if (typeof data.value !== 'string') {
        data.value = ''
      }
      return data
    }),

    map(processZoneImgRow),
  )

}


/** parse width,height with globalScale */
function parseVoucherConfigMapScale(configMap: VoucherConfigMap, globalScale: number): VoucherConfigMap {
  const ret = <VoucherConfigMap> new Map()

  for (const [bankName, row] of configMap) {
    const config: VoucherConfig = { ...row }
    const ocrZones = <OcrZone[]> []

    for (const zone of config.ocrZones) {
      ocrZones.push(parseOcrZoneScale(zone, globalScale))
    }
    config.ocrZones = ocrZones
    config.width = config.width * globalScale
    config.height = config.height * globalScale
    config.marginBottom = config.marginBottom * globalScale

    ret.set(bankName, config)
  }

  return ret
}

/** parse width,height with globalScale */
function parseOcrZoneScale(config: OcrZone, globalScale: number): OcrZone {
  const ret = <OcrZone> { ...config }

  ret.width = ret.width * globalScale
  ret.height = ret.height * globalScale
  ret.offsetX = ret.offsetX * globalScale
  ret.offsetY = ret.offsetY * globalScale

  return ret
}
