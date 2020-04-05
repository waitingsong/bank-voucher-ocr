/* eslint-disable id-length */

import {
  basename,
  copyFileAsync,
  join,
} from '@waiting/shared-core'
import { crop, info as getImgInfo, resize, IInfoResult } from 'easyimage'
import * as moment_ from 'moment'
import { defer, of, range, Observable } from 'rxjs'
import {
  concatMap,
  map,
  mergeMap,
  tap,
} from 'rxjs/operators'

import {
  Filename, ImgFileInfo, ParsePageMarginOpts, SplitPageOpts, VoucherConfig, VoucherImgMap,
} from './model'



const moment = moment_


export function parsePageMargin(
  options: ParsePageMarginOpts,
  debug = false,
): Observable<ImgFileInfo> {

  debug && console.info(
    `parsePageMargin():  ${new Date()}\n`,
    { options },
  )

  const {
    srcPath,
    targetDir,
    pageMarginTop,
    pageMarginLeft,
    pageMarginRight,
    pageMarginBottom,
  } = options

  const info$: Observable<IInfoResult> = readImgInfo(srcPath)
  const ret$ = info$.pipe(
    mergeMap((info: IInfoResult) => {
      const x = pageMarginLeft
      const y = pageMarginTop
      const width = info.width - x - pageMarginRight
      const height = info.height - y - pageMarginBottom

      const filename = basename(srcPath)
      const dst = join(targetDir, filename)
      const opts = {
        dst,
        src: srcPath,
        quality: 99,
        cropWidth: width,
        cropHeight: height,
        x,
        y,
      }
      return crop(opts)
    }),
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
  return ret$

}

export function splitPagetoItems(
  srcPath: string,
  targetDir: string,
  itemConfig: VoucherConfig | void,
  debug = false,
): Observable<Map<Filename, ImgFileInfo>> {

  debug && console.info(
    `splitPagetoItems():  ${new Date()}\n`,
    { srcPath, targetDir },
  )

  const info$: Observable<IInfoResult> = readImgInfo(srcPath)
  const ret$ = info$.pipe(
    map((info: IInfoResult) => {
      const fileMap: VoucherImgMap = new Map()

      if (! itemConfig) {
        const longName = genSplitPagetoItemsName(basename(info.name), 0)
        const dst = join(targetDir, longName)
        const cp$ = defer(() => copyFileAsync(info.path, dst)).pipe(
          map(() => {
            const imgFileInfo: ImgFileInfo = {
              name: longName,
              path: dst,
              width: info.width,
              height: info.height,
              size: info.size,
            }

            fileMap.set(imgFileInfo.name, imgFileInfo)
            return fileMap
          }),
          tap((retMap) => {
            debug && console.info(
              `splitPagetoItems(): result during !itemConfig ${new Date()}\n`,
              { srcPath, targetDir, fileMap: retMap },
            )
          }),
        )

        return cp$
      }

      const itemCount = calcItemsPerPage(info.height, itemConfig.height)

      if (itemCount < 1) {
        return of(fileMap)
      }

      return range(0, itemCount).pipe(
        mergeMap((index) => {
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
            mergeMap((fileInfo) => {
              const fileMap2: VoucherImgMap = new Map()

              if (fileInfo.name) {
                fileMap2.set(fileInfo.name, fileInfo)
              }
              return of(fileMap2)
            }),
          )
        }),
      )
    }),
    concatMap(retMap => retMap),
  )

  return ret$
}


export function resizeAndSaveImg(
  srcPath: string,
  targetPath: string,
  scale: number, // 0-1
  quality: number, // jpegQuality 1-100
): Observable<ImgFileInfo> {

  if (scale <= 0 || scale > 1) {
    throw new Error(`value of scale invalid: "${scale}"`)
  }

  return readImgInfo(srcPath).pipe(
    mergeMap((info) => {
      const opts = {
        src: srcPath,
        dst: targetPath,
        width: info.width * scale,
        height: info.height * scale,
        quality,
      }
      return defer(() => resize(opts))
    }),
    map((info) => {
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


/** Split into single voucher item from a page and save it */
function parseSplitPage(options: SplitPageOpts): Observable<ImgFileInfo> {
  const { index, srcPath, pageHeight } = options
  const { width, marginBottom } = options.itemConfig
  let { height } = options.itemConfig
  // const marginBottom = 36  // pixel. ca 3mm during 300dpi
  const x = 0
  const y = index * height

  if (y + height > pageHeight) {
    height = pageHeight - y
  }

  if (height / pageHeight < 0.1 || height < 100) {
    const ret: ImgFileInfo = {
      name: '',
      path: '',
      width: 0,
      height: 0,
      size: 0,
    }
    return of(ret)
  }
  const filename = basename(srcPath)
  const [name] = filename.split('.')
  const longName = genSplitPagetoItemsName(name, index)
  const dst = join(options.targetDir, longName)
  const opts = {
    dst,
    src: srcPath,
    quality: 100, // 100 for ocr
    cropWidth: width,
    cropHeight: height + marginBottom,
    x,
    y,
  }
  // console.info('split page opts:', opts)

  return defer(() => crop(opts)).pipe(
    mergeMap((info: IInfoResult) => {
      const ret: ImgFileInfo = {
        name: info.name,
        path: info.path,
        width: info.width,
        height: info.height,
        size: info.size, // maybe float value and not accurate...
      }
      return of(ret)
    }),
  )
}

/**
 * Generate name of result filename of splitPagetoItems()
 *
 * @param baseName without file ext
 * Return jpg format:
 * ${today}-${name}-${ Math.random() }-${index}.jpg
 */
function genSplitPagetoItemsName(baseName: string, index: number): Filename {
  if (index < 0) {
    throw new Error('Value of param index of genSplitPagetoItemsName(name, index) invalid: ' + index.toString())
  }
  const curDate = moment().format('YYYYMMDD')
  const ret = `${curDate}-${baseName}-${Math.random()}-${index}.jpg`
  return ret
}

export function readImgInfo(path: string): Observable<IInfoResult> {
  return defer(() => getImgInfo(path))
}

// calculate item numbers of one scan page
function calcItemsPerPage(pageHeight: number, itemHeight: number): number {
  const delta = 33 // pixel ca 3mm during 300dpi

  return pageHeight >= itemHeight
    ? Math.ceil((pageHeight + delta) / itemHeight)
    : 1 // use one !
}

