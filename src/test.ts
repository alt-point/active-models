import { ActiveModel, ActiveField } from './'

class S4 extends ActiveModel {
  @ActiveField('')
  name: string = ''
}

class S3 extends ActiveModel {
  @ActiveField({
    factory: [S4, () => new S4()],
  })
  aaa: S4 | null = new S4()

  @ActiveField({
    factory: [S4, () => null],
  })
  bbb: S4 | null = null
}

class S2 extends ActiveModel {
  @ActiveField({
    factory: [S3, () => new S3()],
  })
  s3: S3 = new S3()
}

class S1 extends ActiveModel {
  @ActiveField({
    factory: [S2, () => new S2()],
  })
  s2: S2 = new S2()
}

class TestModel extends ActiveModel {
  @ActiveField({
    factory: [S1, () => null],
  })
  s1: S1 | null = null
}


export const test = () => {
  console.group('test')
  const model = new TestModel()
  model.s1 = S1.create()
  console.log('Изменили', model.s1)
  console.groupEnd()
}


