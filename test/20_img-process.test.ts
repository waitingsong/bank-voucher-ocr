import { basename, normalize } from 'path'
import * as assert from 'power-assert'

import { parsePageMargin } from '../src/lib/img-process'
import { ParsePageMarginOpts } from '../src/lib/model'


const filename = basename(__filename)

describe(filename, () => {

  it('Should FnName of definition be string', async () => {
    const opts: ParsePageMarginOpts = {
      srcPath: `${__dirname}/zg.jpg`,
      targetDir: `${__dirname}/dst`,
      pageMarginTop: 170,
      pageMarginLeft: 100,
      pageMarginRight: 100,
      pageMarginBottom: 170,
    }

    const ret = await parsePageMargin(opts, true).toPromise()
    console.log(ret)
    assert(ret)
    assert(ret.name)
    assert(ret.path)
    assert(ret.width > 0)
    assert(ret.height > 0)
    assert(ret.size > 0)
  })

})

