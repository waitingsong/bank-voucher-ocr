import { crop, info as getImgInfo, resize, IInfoResult } from 'easyimage'
import * as moment_ from 'moment'
import { from as ofrom, of, range, Observable } from 'rxjs'
import {
  concatMap,
  map,
  mergeMap,
} from 'rxjs/operators'

import {
  join,
} from '../shared/index'

import {
  Filename, ImgFileInfo, SplitPageOpts, VoucherConfig, VoucherImgMap,
} from './model'


const moment = moment_


export function splitPagetoItems(
  srcPath: string,
  targetDir: string,
  itemConfig: VoucherConfig,
): Observable<Map<Filename, ImgFileInfo>> {

  return readImgInfo(srcPath).pipe(
    map(info => {
      const itemCount = calcItemsPerPage(info.height, itemConfig.height)

      if (itemCount) {
        return range(0, itemCount).pipe(
          mergeMap(index => {
            const splitPageOpts = {
              index, // split index for position
              itemConfig: { ...itemConfig },
              srcPath, // source image
              targetDir, // result image folder
              pageHeight: info.height,
            }

            if (info.width < splitPageOpts.itemConfig.width) {
              splitPageOpts.itemConfig.width = info.width
            }

            return parseSplitPage(splitPageOpts).pipe(
              mergeMap(fileInfo => {
                const fileMap = <VoucherImgMap> new Map()

                fileMap.set(fileInfo.name, fileInfo)
                return of(fileMap)
              }),
            )
          }),
        )
      }
      else {
        return of(<Map<Filename, ImgFileInfo>> new Map())
      }
    }),
    concatMap(retMap => retMap),
  )

}


export function resizeAndSaveImg(
  srcPath: string,
  targetPath: string,
  scale: number,  // 0-1
  quality: number,  // jpegQuality 1-100
): Observable<ImgFileInfo> {

  if (scale <= 0 || scale > 1) {
    throw new Error(`value of scale invalid: "${scale}"`)
  }

  return readImgInfo(srcPath).pipe(
    mergeMap(info => {
      const opts = {
        src: srcPath,
        dst: targetPath,
        width: info.width * scale,
        height: info.height * scale,
        quality,
      }
      return ofrom(resize(opts))
    }),
    map(info => {
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


// split one voucher item from a page and save it
function parseSplitPage(options: SplitPageOpts): Observable<ImgFileInfo> {
  const { index, srcPath, pageHeight } = options
  const { width } = options.itemConfig
  let { height } = options.itemConfig
  const padding = 36  // pixel. ca 3mm during 300dpi
  const x = 0
  const y = index * height

  if (y + height > pageHeight) {
    height = pageHeight - y
  }

  const curDate = moment().format('YYYYMMDD')
  const dst = join(options.targetDir, `${curDate}-${ Math.random() }-${index}.jpg`)
  const opts = {
    dst,
    src: srcPath,
    quality: 100, // 100 for ocr
    cropWidth: width,
    cropHeight: height + padding,
    x,
    y,
  }

  return ofrom(crop(opts)).pipe(
    mergeMap((info: IInfoResult) => {
      const ret: ImgFileInfo = {
        name: info.name,
        path: info.path,
        width: info.width,
        height: info.height,
        size: info.size,  // maybe float value and not accurate...
      }
      return of(ret)
    }),
  )
}

function readImgInfo(path: string): Observable<IInfoResult> {
  return ofrom(getImgInfo(path))
}

// calculate item numbers of one scan page
function calcItemsPerPage(pageHeight: number, itemHeight: number): number {
  const delta = 33  // pixel ca 3mm during 300dpi

  return pageHeight >= itemHeight
    ? Math.floor((pageHeight + delta) / itemHeight)
    : 0
}
