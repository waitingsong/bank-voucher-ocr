export type SendArgs = Array<string | number> | string | number
export type PlainText = string  // 明文
export type EncodedText = string  // base64格式签名数据
export type Filename = string

export interface OcrOpts {
  bankName?: BankName
  /** For recognize bank from page */
  bankZone: OcrZone
  baseTmpDir?: string
  /** os.cpus() if undefined */
  concurrent?: number
  debug?: boolean
  /** Default tesseract ocr lang, eg 'eng' */
  defaultOcrLang: string
  /** Not need to split if true. Default:false */
  isSingleVoucher?: boolean
  /** Result image quality (0, 100] */
  jpegQuality: number
  /** Store result images */
  resizeImgDir?: string
  /** Save resize result image  (0, 1] */
  scale: number
  /** Folder store images not recogniezed bank */
  skipImgDir?: string
  /**
   * if item of voucherConfigMap for 300api,
   * but source image is 600dpi then set thie value to 600/300==2.
   * Default:1
   */
  globalScale: number
  /** Store temp split images to ocr */
  splitTmpDir?: string
  voucherConfigMap: VoucherConfigMap
  pageMarginTop: number
  pageMarginLeft: number
  pageMarginRight: number
  pageMarginBottom: number
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
  /** 农行 */
  abc = 'abc',
  /** 中行 */
  boc = 'boc',
  /** 交行 */
  bocm = 'bocm',
  /** 建行 */
  ccb = 'ccb',
  /** 工行 */
  icbc = 'icbc',
  /** 自贡银行 */
  zigong = 'zigong',
}

// names of crop zone for ocr
// for regexp match
export const enum FieldName {
  amount = 'amount', // money amount
  bank = 'bank',
  date = 'date',
  destAccountNumber = 'destAccountNumber',
  paymentAccountNumber = 'paymentAccountNumber',
  sn = 'sn',  // serial number
}
export const enum OcrRetInfoKey {
  filename = 'filename',
  path = 'path',
}

export type OcrRetInfo = Map<OcrRetInfoKey | FieldName, string>
export type VoucherConfigMap = Map<BankName, VoucherConfig>
// for transport
export type OcrRetObjectTypeKey = FieldNameTypeKey | keyof typeof OcrRetInfoKey
export type OcrRetObject = {
  [key in OcrRetObjectTypeKey]: string  // OcrRetInfoKey: string
}

export interface OcrZoneRet {
  fieldName: FieldName
  zoneName: FieldName
  value: string
  usedLang: string
  txtPath: string // ocr result txt file without extension
}

// regexp match item with order
export type RegexpArray = ReadonlyArray<RegExp>

export interface VoucherConfig {
  bankName: BankName
  width: number
  height: number
  // pixel for splitPage. positive for more hieght, negative for less height. if value 36 ca 3mm during 300dpi
  marginBottom: number
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

export interface ParsePageMarginOpts {
  srcPath: string,
  targetDir: string,
  pageMarginTop: number
  pageMarginLeft: number
  pageMarginRight: number
  pageMarginBottom: number
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
  /**
   * name 格式 ${today}-${name}-${ Math.random() }-${index}.jpg
   * eg. 20180705-A15307725600001-0.2834807279585585-0.jpg
   * 20180705 处理日期
   * A15307725600001 高扫生成序列号
   * 0.2834807279585585 切分随机数
   * 0 page切分结果序列号
   */
  imgInfo: ImgFileInfo
}

export interface RecognizeFieldsOpts {
  bankName: BankName
  baseDir: string
  debug: boolean
  defaultValue: string
  imgInfo: ImgFileInfo
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
  skipImgDir?: string // folder store skip images which not recognized with bank
}

export interface BatchOcrAndRetrieve {
  zoneImgMap: ZoneImgMap
  bankConfig: VoucherConfig
  ocrFields: OcrFields
  defaultValue: string
  debug: boolean
}

export interface SaveImgAndPruneOpts {
  retInfo: OcrRetInfo
  resizeDir: string
  scale: number // 0-1
  jpegQuality: number // 1-100
  debug: boolean
}

export type OcrRetTxtMap = Map<FieldName, OcrRetLangMap>
export type OcrRetLangMap = Map<string, string> // Map<lang, txtPath>  txtPath without extension

