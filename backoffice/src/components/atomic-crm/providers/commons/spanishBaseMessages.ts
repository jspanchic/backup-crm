// Traducciones de la interfaz de react-admin y de autenticación de Supabase.
// Las variables entre %{...} y los plurales |||| los utiliza Polyglot.
export const spanishRaMessages = {
  ra: {
    action: {
      add_filter: "Añadir filtro",
      add: "Añadir",
      back: "Volver",
      bulk_actions:
        "1 elemento seleccionado |||| %{smart_count} elementos seleccionados",
      cancel: "Cancelar",
      clear_array_input: "Vaciar la lista",
      clear_input_value: "Borrar valor",
      clone: "Duplicar",
      confirm: "Confirmar",
      create: "Crear",
      create_item: "Crear %{item}",
      delete: "Eliminar",
      edit: "Editar",
      export: "Exportar",
      list: "Lista",
      refresh: "Actualizar",
      remove_filter: "Quitar este filtro",
      remove_all_filters: "Quitar todos los filtros",
      remove: "Quitar",
      reset: "Restablecer",
      save: "Guardar",
      search: "Buscar",
      search_columns: "Buscar columnas",
      select_all: "Seleccionar todo",
      select_all_button: "Seleccionar todo",
      select_row: "Seleccionar esta fila",
      show: "Ver",
      sort: "Ordenar",
      undo: "Deshacer",
      unselect: "Deseleccionar",
      expand: "Expandir",
      close: "Cerrar",
      open_menu: "Abrir menú",
      close_menu: "Cerrar menú",
      update: "Actualizar",
      move_up: "Mover arriba",
      move_down: "Mover abajo",
      open: "Abrir",
      toggle_theme: "Cambiar entre modo claro y oscuro",
      select_columns: "Columnas",
      update_application: "Recargar aplicación",
    },
    boolean: { true: "Sí", false: "No", null: " " },
    page: {
      create: "Crear %{name}",
      dashboard: "Panel principal",
      edit: "%{name} %{recordRepresentation}",
      error: "Algo salió mal",
      list: "%{name}",
      loading: "Cargando",
      not_found: "No encontrado",
      show: "%{name} %{recordRepresentation}",
      empty: "Todavía no hay %{name}.",
      invite: "¿Quieres añadir uno?",
      access_denied: "Acceso denegado",
      authentication_error: "Error de autenticación",
    },
    input: {
      file: {
        upload_several:
          "Arrastra archivos aquí o haz clic para seleccionarlos.",
        upload_single:
          "Arrastra un archivo aquí o haz clic para seleccionarlo.",
      },
      image: {
        upload_several:
          "Arrastra imágenes aquí o haz clic para seleccionarlas.",
        upload_single:
          "Arrastra una imagen aquí o haz clic para seleccionarla.",
      },
      references: {
        all_missing: "No se encontraron los datos relacionados.",
        many_missing:
          "Al menos uno de los elementos relacionados ya no está disponible.",
        single_missing: "El elemento relacionado ya no está disponible.",
      },
      password: {
        toggle_visible: "Ocultar contraseña",
        toggle_hidden: "Mostrar contraseña",
      },
    },
    message: {
      about: "Acerca de",
      access_denied: "No tienes permisos para acceder a esta página.",
      are_you_sure: "¿Estás seguro?",
      authentication_error:
        "El servidor de autenticación devolvió un error y no se pudieron comprobar tus credenciales.",
      auth_error: "Ocurrió un error al validar el token de autenticación.",
      bulk_delete_content:
        "¿Seguro que quieres eliminar este elemento %{name}? |||| ¿Seguro que quieres eliminar estos %{smart_count} elementos?",
      bulk_delete_title:
        "Eliminar %{name} |||| Eliminar %{smart_count} %{name}",
      bulk_update_content:
        "¿Seguro que quieres actualizar %{name} %{recordRepresentation}? |||| ¿Seguro que quieres actualizar estos %{smart_count} elementos?",
      bulk_update_title:
        "Actualizar %{name} %{recordRepresentation} |||| Actualizar %{smart_count} %{name}",
      clear_array_input: "¿Seguro que quieres vaciar toda la lista?",
      delete_content: "¿Seguro que quieres eliminar este elemento %{name}?",
      delete_title: "Eliminar %{name} %{recordRepresentation}",
      details: "Detalles",
      error:
        "Ocurrió un error en la aplicación y no se pudo completar la solicitud.",
      invalid_form: "El formulario no es válido. Revisa los errores.",
      loading: "Espera un momento",
      no: "No",
      not_found:
        "La dirección es incorrecta o el enlace ya no está disponible.",
      select_all_limit_reached:
        "Hay demasiados elementos para seleccionarlos todos. Solo se seleccionaron los primeros %{max}.",
      unsaved_changes:
        "Tienes cambios sin guardar. ¿Seguro que quieres descartarlos?",
      yes: "Sí",
      placeholder_data_warning:
        "Problema de conexión: no se pudieron actualizar los datos.",
    },
    navigation: {
      clear_filters: "Borrar filtros",
      no_filtered_results: "No se encontró %{name} con los filtros actuales.",
      no_results: "No se encontró %{name}",
      no_more_results:
        "La página %{page} está fuera de los límites. Prueba la página anterior.",
      page_out_of_boundaries: "La página %{page} está fuera de los límites",
      page_out_from_end: "No se puede avanzar después de la última página",
      page_out_from_begin: "No se puede retroceder antes de la primera página",
      page_range_info: "%{offsetBegin}-%{offsetEnd} de %{total}",
      partial_page_range_info:
        "%{offsetBegin}-%{offsetEnd} de más de %{offsetEnd}",
      current_page: "Página %{page}",
      page: "Ir a la página %{page}",
      first: "Ir a la primera página",
      last: "Ir a la última página",
      next: "Ir a la página siguiente",
      previous: "Ir a la página anterior",
      page_rows_per_page: "Filas por página:",
      skip_nav: "Ir al contenido",
    },
    sort: {
      sort_by: "Ordenar por %{field_lower_first} %{order}",
      ASC: "ascendente",
      DESC: "descendente",
    },
    auth: {
      auth_check_error: "Inicia sesión para continuar",
      user_menu: "Perfil",
      username: "Nombre de usuario",
      password: "Contraseña",
      email: "Correo electrónico",
      sign_in: "Iniciar sesión",
      sign_in_error: "No se pudo iniciar sesión. Inténtalo de nuevo.",
      logout: "Cerrar sesión",
    },
    notification: {
      updated:
        "Elemento actualizado |||| %{smart_count} elementos actualizados",
      created: "Elemento creado",
      deleted: "Elemento eliminado |||| %{smart_count} elementos eliminados",
      bad_item: "Elemento incorrecto",
      item_doesnt_exist: "El elemento no existe",
      http_error: "Error de comunicación con el servidor",
      data_provider_error:
        "Error del proveedor de datos. Consulta la consola para más detalles.",
      i18n_error:
        "No se pudieron cargar las traducciones del idioma seleccionado",
      canceled: "Acción cancelada",
      logged_out: "Tu sesión ha terminado. Vuelve a iniciar sesión.",
      not_authorized: "No tienes permiso para acceder a este recurso.",
      application_update_available: "Hay una nueva versión disponible.",
      offline: "Sin conexión. No se pudieron obtener los datos.",
    },
    validation: {
      required: "Obligatorio",
      minLength: "Debe tener al menos %{min} caracteres",
      maxLength: "Debe tener como máximo %{max} caracteres",
      minValue: "Debe ser al menos %{min}",
      maxValue: "Debe ser como máximo %{max}",
      number: "Debe ser un número",
      email: "Debe ser un correo electrónico válido",
      oneOf: "Debe ser uno de estos valores: %{options}",
      regex: "Debe cumplir el formato requerido: %{pattern}",
      unique: "Debe ser único",
    },
    saved_queries: {
      label: "Consultas guardadas",
      query_name: "Nombre de la consulta",
      new_label: "Guardar consulta actual...",
      new_dialog_title: "Guardar consulta actual como",
      remove_label: "Eliminar consulta guardada",
      remove_label_with_name: 'Eliminar consulta "%{name}"',
      remove_dialog_title: "¿Eliminar consulta guardada?",
      remove_message: "¿Seguro que quieres eliminar esta consulta de tu lista?",
      help: "Filtra la lista y guarda esta consulta para usarla después",
    },
    guesser: {
      empty: {
        title: "No hay datos para mostrar",
        message: "Comprueba el proveedor de datos",
      },
    },
    configurable: {
      customize: "Personalizar",
      configureMode: "Configurar esta página",
      inspector: {
        title: "Inspector",
        content: "Pasa el cursor sobre los elementos para configurarlos",
        reset: "Restablecer configuración",
        hideAll: "Ocultar todo",
        showAll: "Mostrar todo",
      },
      Datagrid: {
        title: "Tabla de datos",
        unlabeled: "Columna sin etiqueta #%{column}",
      },
      SimpleForm: {
        title: "Formulario",
        unlabeled: "Campo sin etiqueta #%{input}",
      },
      SimpleList: {
        title: "Lista",
        primaryText: "Texto principal",
        secondaryText: "Texto secundario",
        tertiaryText: "Texto terciario",
      },
    },
  },
};

export const spanishSupabaseMessages = {
  "ra-supabase": {
    auth: {
      email: "Correo electrónico",
      confirm_password: "Confirmar contraseña",
      sign_in_with: "Iniciar sesión con %{provider}",
      forgot_password: "¿Olvidaste tu contraseña?",
      reset_password: "Restablecer contraseña",
      password_reset:
        "Revisa tu correo para encontrar el mensaje para restablecer la contraseña.",
      missing_tokens: "Faltan los tokens de acceso y actualización",
      back_to_login: "Volver al inicio de sesión",
    },
    reset_password: {
      forgot_password: "¿Olvidaste tu contraseña?",
      forgot_password_details:
        "Introduce tu correo electrónico para recibir instrucciones.",
    },
    set_password: { new_password: "Elige tu contraseña" },
    validation: { password_mismatch: "Las contraseñas no coinciden" },
    oauth: {
      authorize: "Autorizar aplicación",
      authorize_details: "Esta aplicación quiere acceder a tu cuenta.",
      access_scope:
        "Podrá leer y modificar tus datos con los mismos permisos que tu cuenta.",
      approved: "Autorización aprobada",
      close_tab: "Ya puedes cerrar esta pestaña.",
      no_request: "No se encontró ninguna solicitud de autorización",
    },
  },
};
