import { z } from 'zod';

/**
 * Every user-facing validation error must be in Russian (no raw Zod/English
 * text should ever reach the UI). Setting this once, here, covers every
 * schema in this package automatically — both the explicit .min()/.max()
 * custom messages (which take priority when present) and the plain fields
 * that rely on Zod's defaults.
 */
const ruErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'Обязательное поле' };
      return { message: 'Неверный тип данных' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message:
            issue.minimum === 1
              ? 'Это поле не может быть пустым'
              : `Слишком коротко — минимум ${issue.minimum} симв.`,
        };
      }
      if (issue.type === 'number') return { message: `Значение должно быть не меньше ${issue.minimum}` };
      if (issue.type === 'array') return { message: `Нужно как минимум ${issue.minimum} эл.` };
      return { message: 'Слишком маленькое значение' };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Слишком длинно — максимум ${issue.maximum} симв.` };
      if (issue.type === 'number') return { message: `Значение должно быть не больше ${issue.maximum}` };
      return { message: 'Слишком большое значение' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Введите корректный email' };
      if (issue.validation === 'url') return { message: 'Введите корректную ссылку' };
      if (issue.validation === 'uuid') return { message: 'Некорректный идентификатор' };
      return { message: 'Некорректный формат' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Недопустимое значение' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(ruErrorMap);
