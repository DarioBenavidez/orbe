# Orbe — Reglas de trabajo

## Modo de operación

1. **Modo plan por defecto** para tareas de 3+ pasos o decisiones de arquitectura
   - Si algo se desvía, detener y volver a planear
   - Usar plan para verificar, no solo para construir
   - Especificaciones claras desde el inicio

2. **Subagentes** para mantener limpio el contexto principal
   - Delegar investigación, exploración y análisis paralelo
   - Un solo objetivo por subagente
   - Usar más cómputo para problemas complejos

3. **Ciclo de auto-mejora**
   - Después de cualquier corrección del usuario, actualizar este archivo con el patrón
   - Escribir reglas para evitar repetir el mismo error
   - Revisar este archivo al inicio de cada sesión

4. **Verificación antes de terminar**
   - Nunca marcar tarea como completada sin demostrar que funciona
   - Ejecutar pruebas, revisar logs, demostrar que es correcto
   - Preguntarse: "¿Un ingeniero senior aprobaría esto?"

5. **Elegancia equilibrada**
   - Para cambios complejos, pausar y buscar solución más elegante
   - Para arreglos simples, no sobre-ingenierizar
   - Cuestionar el propio trabajo antes de presentarlo

6. **Corrección autónoma de errores**
   - Si hay reporte de error, arreglarlo sin esperar instrucciones adicionales
   - Revisar logs, errores y pruebas fallidas
   - No obligar al usuario a cambiar de contexto

## Gestión de cambios
- **Simplicidad primero**: cada cambio debe ser lo más simple posible
- **Sin pereza**: encontrar causa raíz, evitar soluciones temporales
- **Impacto mínimo**: cambiar solo lo necesario

## Lecciones aprendidas

### 2025-03-17 — Extracción de módulos
- **Error**: Al extraer scheduler/index.js con script de Node, se incluyó código residual del módulo anterior (tail de processAction)
- **Regla**: Después de cualquier extracción automática, leer las primeras 30 líneas del archivo generado para verificar que el inicio es correcto

### 2025-03-17 — Import faltante en módulo extraído
- **Error**: `today` se usaba en ai/interpret.js pero no estaba en la línea de imports → `ReferenceError` en producción
- **Regla**: Antes de deployar una refactorización de módulos, grep de todas las variables usadas vs importadas en cada nuevo archivo
