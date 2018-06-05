export type SendArgs = Array<string | number> | string | number
export type PlainText = string  // 明文
export type EncodedText = string  // base64格式签名数据
export type Filename = string

export interface OcrOpts {
  bankZone: OcrZone // for recognize bank from page
  baseTmpDir?: string
  debug?: boolean
  defaultOcrLang: string  // default tesseract ocr lang, eg 'eng'
  jpegQuality: number // result image quality (0, 100]
  resizeImgDir?: string // store result images
  scale: number // resize result image  (0, 1]
  splitTmpDir?: string  // store temp split images to ocr
  voucherConfigMap: VoucherConfigMap
}

export const enum Actions {
  exception = 'exception',
  initial = 'initial',
  noneAvailable = 'eventNoneAvailable',
  fileChanged = 'fileChanged',
}

export interface BVOEvent {
  action: Actions
  err?: Error
  msg?: string
  payload?: any
}

export const enum BankName {
  NA = 'n/a',
  abc = 'abc',  // 农行
  boc = 'boc',  // 中行
  bocm = 'bocm',  // 交行
  ccb = 'ccb',  // 建行
  icbc = 'icbc',  // 工行
}

// names of crop zone for ocr
// for regexp match
export const enum FieldName {
  amount = 'amount', // money amount
  bank = 'bank',
  date = 'date',
  sn = 'sn',  // serial number
}



export type OcrRetInfoKey = FieldName | 'filename' | 'path'
export type OcrRetInfo = Map<OcrRetInfoKey, string>
export type VoucherConfigMap = Map<BankName, VoucherConfig>


export interface OcrZoneRet {
  fieldName: FieldName
  value: string
}

// regexp match item with order
export type RegexpArray = ReadonlyArray<RegExp>

export interface VoucherConfig {
  bankName: BankName
  width: number
  height: number
  ocrFields: OcrFields
  ocrDefaultLangs: OcrLangs
  ocrFieldLangs?: Partial<OcrFieldLangs>
  ocrZones: OcrZones
  regexpOpts: ZoneRegexpOpts
}


/**
 * lang order
 * eg. ['eng', 'chi_sim'], first try eng, and retry chi_sim if failed with eng
 * value see: https://github.com/tesseract-ocr/tesseract/wiki/Data-Files
 */
export type OcrLangs = ReadonlyArray<string>

export type FieldNameTypeKey = keyof typeof FieldName
export type ZoneRegexpOpts = {
  [zoneName in FieldNameTypeKey]: RegexpArray
}
export type BankRegexpOptsMap = Map<BankName, RegexpArray>

export type OcrFieldLangs = {
  [zoneName in FieldNameTypeKey]: OcrLangs
}


// crop zone for OCR
export interface OcrZone {
  zoneName: FieldName
  width: number
  height: number
  offsetX: number
  offsetY: number
}
export type OcrZones = ReadonlyArray<OcrZone>

/**
 * retrieve fields from mapped zones
 * bank => [bank] and sn => [bank]
 * both bank and sn from one zone
 */
export type OcrFields = {
  [field in FieldNameTypeKey]?: FieldName
}


export type ZoneImgRow = [FieldName , ImgFileInfo]
export type ZoneImgMap = Map<FieldName, ImgFileInfo> // result of crop zones

export interface ImgInfo {
  key: string
  path: string
  durl: string  // DataUrl
}

export interface SplitPageOpts {
  index: number // split index for position
  itemConfig: VoucherConfig
  srcPath: string   // source image
  targetDir: string  // result image folder
  pageHeight: number
}


export interface ImgFileInfo {
  name: Filename  // excluding the folder
  path: string  // file path
  width: number
  height: number
  size: number
}

export interface ZoneImgInfo extends ImgFileInfo {
  zoneName: FieldName
}


export type VoucherImgMap = Map<Filename, ImgFileInfo>

export type PreProcessBufferFn = (buf: Buffer) => string

export interface PageBankRet {
  bankName: BankName
  pagePath: string
}

export interface PageToImgRet {
  bankName: BankName
  imgFile: ImgFileInfo
}

export interface RecognizeFieldsOpts {
  bankName: BankName
  baseDir: string
  concurrent: number
  debug: boolean
  defaultValue: string
  imgFile: ImgFileInfo
  ocrFields: OcrFields
  voucherConfigMap: VoucherConfigMap
}

export interface RecognizePageBankOpts {
  baseDir: string
  path: string
  bankZone: OcrZone
  bankRegexpOptsMap: BankRegexpOptsMap
  debug: boolean
  lang: string
}
