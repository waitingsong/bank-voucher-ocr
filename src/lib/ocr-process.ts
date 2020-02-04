/* eslint-disable id-length */
import {
  BankName, FieldName, ImgFileInfo, OcrFields, OcrZone,
  VoucherConfig, VoucherConfigMap, ZoneImgMap,
} from './model'

import { join } from '@waiting/shared-core'
import { crop, IInfoResult } from 'easyimage'
import { defer, from as ofrom, of, Observable } from 'rxjs'
import {
  catchError, last, map, mapTo, mergeMap, reduce,
} from 'rxjs/operators'
import { run } from 'rxrunscript'



export function getOcrZoneOptsByBankName(bankName: BankName, configMap: VoucherConfigMap): VoucherConfig | void {
  return configMap.get(bankName)
}


// crop all defined zones from a image
export function cropImgAllZones(
  srcPath: string,
  zoneTmpDir: string,
  ocrFields: OcrFields,
  ocrZoneOptsArr: readonly OcrZone[],
): Observable<ZoneImgMap> {

  const flds: OcrZone[] = []
  const srcFldSet = new Set()

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
    mergeMap((ocrZoneOpts) => {
      return cropImgZone(srcPath, zoneTmpDir, ocrZoneOpts).pipe(
        map((img) => {
          return [ocrZoneOpts.zoneName, img] as [FieldName, ImgFileInfo]
        }),
      )
    }),
    reduce((acc: ZoneImgMap, curr: [FieldName, ImgFileInfo]) => {
      acc.set(curr[0], curr[1])
      return acc
    }, new Map() as ZoneImgMap),
  )

}


export function cropImgZone(srcPath: string, targetDir: string, ocrZoneOpts: OcrZone): Observable<ImgFileInfo> {
  const {
    zoneName, width, height, offsetX, offsetY,
  } = ocrZoneOpts

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

  return defer(() => crop(opts)).pipe(
    map((info: IInfoResult) => {
      const ret: ImgFileInfo = {
        name: info.name,
        path: info.path,
        width: info.width,
        height: info.height,
        size: info.size, // maybe float value and not accurate...
      }
      return ret
    }),
  )

}

// ocr a iamge file, txtPath without extension
export function runOcr(imgPath: string, lang: string, txtPath: string): Observable<void> {
  // lang: second path will be append with '.txt' by tesseract
  const cmd = `tesseract "${imgPath}" "${txtPath}" -l ${lang ? lang : 'eng'}`
  // const opts = {
  //   cwd: 'd:/Program/Tesseract-OCR/tessdata',
  // }
  return run(cmd).pipe(
    last(),
    catchError(() => of(void 0)), // tesseract will exit with code(0) but output with stderr
    mapTo(void 0),
  )
}
