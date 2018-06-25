import { crop, IInfoResult } from 'easyimage'
import { from as ofrom, Observable } from 'rxjs'
import { map, mergeMap, reduce } from 'rxjs/operators'
import run from 'rxrunscript'

import { join } from '../shared/index'

import {
  BankName, FieldName, ImgFileInfo, OcrFields, OcrZone,
  VoucherConfig, VoucherConfigMap, ZoneImgMap,
} from './model'


export function getOcrZoneOptsByBankName(bankName: BankName, configMap: VoucherConfigMap): VoucherConfig | void {
  return configMap.get(bankName)
}


// crop all defined zones from a image
export function cropImgAllZones(
  srcPath: string,
  zoneTmpDir: string,
  ocrFields: OcrFields,
  ocrZoneOptsArr: ReadonlyArray<OcrZone>,
): Observable<ZoneImgMap> {

  const flds = <OcrZone[]> []
  const srcFldSet = <Set<FieldName>> new Set()

  for (const srcFld of Object.values(ocrFields)) {
    if (! srcFld || srcFldSet.has(srcFld)) {
      continue
    }
    srcFldSet.add(srcFld)
  }
  for (const row of ocrZoneOptsArr) {
    const fld = row.zoneName

    if (fld && srcFldSet.has(fld)) {
      flds.push(row)
    }
  }

  return ofrom(flds).pipe(
    mergeMap(ocrZoneOpts => {
      return cropImgZone(srcPath, zoneTmpDir, ocrZoneOpts).pipe(
        map(img => {
          return <[FieldName, ImgFileInfo]> [ocrZoneOpts.zoneName, img]
        }),
      )
    }),
    reduce((acc: ZoneImgMap, curr: [FieldName, ImgFileInfo]) => {
      acc.set(curr[0], curr[1])
      return acc
    }, <ZoneImgMap> new Map()),
  )

}


export function cropImgZone(srcPath: string, targetDir: string, ocrZoneOpts: OcrZone): Observable<ImgFileInfo> {
  const { zoneName, width, height, offsetX, offsetY } = ocrZoneOpts

  const dst = join(targetDir, `${zoneName}-${Math.random()}.png`)
  const opts = {
    dst,
    src: srcPath,
    quality: 100, // 100 for ocr
    cropWidth: width,
    cropHeight: height,
    x: offsetX,
    y: offsetY,
  }
  // console.info('croop', srcPath, opts)

  return ofrom(crop(opts)).pipe(
    map((info: IInfoResult) => {
      const ret: ImgFileInfo = {
        name: info.name,
        path: info.path,
        width: info.width,
        height: info.height,
        size: info.size,  // maybe float value and not accurate...
      }
      return ret
    }),
  )

}

// ocr a iamge file
export function runOcr(path: string, lang: string): Observable<Buffer> {
  // second path will be append with '.txt'
  if (! lang) {
    lang = 'eng'
  }
  const cmd = `tesseract "${path}" "${path}" -l ${lang}`
  // const opts = {
  //   cwd: 'd:/Program/Tesseract-OCR/tessdata',
  // }
  return run(cmd)
}
