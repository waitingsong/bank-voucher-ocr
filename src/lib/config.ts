import { join, tmpdir } from '@waiting/shared-core'

import {
  Actions,
  BVOEvent,
  FieldName,
  OcrZone,
} from './model'




export const initialBaseTmpDir = join(tmpdir(), 'voucher-ocr')
export const initialResizeImgDir = join(initialBaseTmpDir, 'resize') // store result images
export const initialSplitTmpDir = join(initialBaseTmpDir, 'split') // store temp split images to ocr
/** src dir for parsed image with margin */
export const srcTmpDirPrefix = 'src'
export const zoneTmpDirPrefix = 'zone'

export const initialEvent: BVOEvent = {
  action: Actions.noneAvailable,
}


export const initialBankZone: OcrZone = {
  zoneName: FieldName.bank,
  width: 2250,
  height: 390,
  offsetX: 70,
  offsetY: 10,
}
